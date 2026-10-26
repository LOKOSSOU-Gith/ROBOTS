"""Service superviseur du moteur (§4, §7, §8.1, §14).

Boucle permanente exécutée comme service supervisé sur le VPS Contabo, jamais
dans une fonction web. Trois responsabilités parallèles :

- distribution : réclamer les commandes, vérifier fraîcheur, licence, version et
  limites avant toute exécution, accuser réception par étape ;
- exécution : faire avancer les instances vivantes à chaque tick et appliquer
  les contrôles de risque dans le processus moteur ;
- publication : heartbeats périodiques, événements et positions, avec file
  locale pour survivre aux coupures réseau.
"""

from __future__ import annotations

import secrets
import signal
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone

from .backend_client import BackendClient, BackendError, Command, TransientBackendError
from .bridge.base import (
    AccountRef,
    BridgeUnavailable,
    ConnectionResult,
    TerminalBridge,
)
from .config import EngineConfig
from .instance import (
    InstanceRuntime,
    InstanceRunner,
    ObjectiveReached,
    RiskHalt,
    _belongs_to_instance,
    instance_snapshot_context,
)
from .logs import get_logger, log_fields
from .parameters import parameters_digest
from .states import LIVE_STATES, InstanceState
from .store import EngineStore
from .strategy.base import StrategyContext
from .strategy.registry import RegistryError, load_builtin_strategies
from .strategy.registry import registered as registered_strategies

log = get_logger("mt5_engine.supervisor")

ENGINE_VERSION = "0.1.0"

COMMAND_RECEIVED = "received"
COMMAND_ACCEPTED = "accepted"
COMMAND_STARTED = "started"
COMMAND_COMPLETED = "completed"
COMMAND_FAILED = "failed"
COMMAND_REJECTED = "rejected"


@dataclass(frozen=True)
class SupervisorStatus:
    state: str
    terminal_kind: str
    broker_connected: bool
    instances: int
    outbox_depth: int

    def as_heartbeat(self) -> dict:
        return {
            "engine_version": ENGINE_VERSION,
            "terminal_kind": self.terminal_kind,
            "state": self.state,
            "broker_connected": self.broker_connected,
            "metrics": {"outbox_depth": self.outbox_depth, "instances": self.instances},
        }


class Supervisor:
    def __init__(
        self,
        config: EngineConfig,
        bridge: TerminalBridge,
        backend: BackendClient,
        store: EngineStore,
    ) -> None:
        self._config = config
        self._bridge = bridge
        self._backend = backend
        self._store = store
        self._runner = InstanceRunner(backend, bridge, store, config.command_max_age_seconds)
        self._instances: dict[str, InstanceRuntime] = {}
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._state = "STARTING"
        self._last_heartbeat = 0.0
        self._last_scan = 0.0

    # --------------------------------------------------------------------- cycle

    def run_forever(self) -> None:
        load_builtin_strategies()
        log_fields(
            "info",
            "moteur démarré",
            {
                "engine_id": self._config.engine_id,
                "terminal_kind": self._bridge.kind,
                "strategies": [f"{slug}@{version}" for slug, version in registered_strategies()],
            },
        )
        self._install_signal_handlers()

        while not self._stop.is_set():
            try:
                self.cycle(time.monotonic())
            except Exception as exc:  # le service ne meurt pas sur une erreur isolée
                log_fields(
                    "error",
                    "erreur de cycle",
                    {"error_type": type(exc).__name__, "error": str(exc)[:200]},
                )
            self._stop.wait(self._config.poll_interval_seconds)

        self.shutdown()

    def cycle(self, now: float) -> None:
        """Un tour de boucle complet, décomposable pour les tests."""
        if now - self._last_heartbeat >= self._config.heartbeat_interval_seconds:
            self.send_heartbeat()
            self._last_heartbeat = now

        self.drain_commands()
        self.flush_outbox()

        if now - self._last_scan >= self._config.scan_interval_seconds:
            self.tick_running_instances()
            self.drain_connection_tests_safely()
            self._last_scan = now

    def drain_connection_tests_safely(self) -> int:
        try:
            return self.drain_connection_tests()
        except (BackendError, TransientBackendError, BridgeUnavailable) as exc:
            log_fields("warning", "test de connexion reporté", {"error": type(exc).__name__})
            return 0

    # -------------------------------------------------------------- publication

    def status(self) -> SupervisorStatus:
        with self._lock:
            instances = list(self._instances.values())
        return SupervisorStatus(
            state=self._state,
            terminal_kind=self._bridge.kind,
            broker_connected=self.safe_ping(),
            instances=len(instances),
            outbox_depth=self._store.outbox_depth(),
        )

    def safe_ping(self) -> bool:
        try:
            return self._bridge.ping()
        except BridgeUnavailable:
            return False

    def send_heartbeat(self) -> None:
        status = self.status()
        payload = status.as_heartbeat()
        with self._lock:
            payload["instance_states"] = [
                {"instance_id": instance.instance_id, "state": instance.state.value}
                for instance in self._instances.values()
            ]
            payload["owner_user_ids"] = sorted(
                {instance.owner_user_id for instance in self._instances.values()}
            )
            accounts: dict[str, dict] = {}
            for instance in self._instances.values():
                if instance.last_account:
                    accounts[instance.account_id] = instance.last_account
            payload["accounts"] = list(accounts.values())
        try:
            response = self._backend.heartbeat(payload)
        except (BackendError, TransientBackendError) as exc:
            self._state = "DISCONNECTED"
            log_fields(
                "warning", "heartbeat non publié", {"error_type": type(exc).__name__}
            )
            return

        # La consigne de licence revient avec le heartbeat : le moteur bloque les
        # nouvelles entrées d'un propriétaire non vérifiable (§11).
        licenses = response.get("licenses") or {}
        with self._lock:
            for instance in self._instances.values():
                usable = licenses.get(instance.owner_user_id)
                if usable is False:
                    instance.new_entries_blocked = True
        self._state = "RUNNING" if any(
            i.state in LIVE_STATES for i in self._instances.values()
        ) else "IDLE"

    # -------------------------------------------------------------- commandes

    def _ack(self, command_id: str, ack: str, **kwargs) -> None:
        """Accusé de réception ; une indisponibilité réseau ne doit pas bloquer le cycle."""
        try:
            self._backend.ack(command_id, ack, **kwargs)
        except (BackendError, TransientBackendError) as exc:
            log_fields(
                "warning",
                "accusé de réception non publié",
                {"ack": ack, "error": type(exc).__name__},
            )

    def drain_commands(self) -> int:
        processed = 0
        while not self._stop.is_set():
            try:
                command = self._backend.next_command()
            except (BackendError, TransientBackendError) as exc:
                log_fields("warning", "distribution indisponible", {"error": type(exc).__name__})
                return processed
            if command is None:
                return processed
            self.handle_command(command)
            processed += 1

    def handle_command(self, command: Command) -> None:
        # Authenticité et fraîcheur d'abord : une commande expirée n'est jamais
        # exécutée, même si elle parvient au moteur (§8.1, §13 T4).
        if command.seconds_remaining() <= 0:
            self._ack(command.id, COMMAND_REJECTED, code="command_expired")
            return

        if self._store.was_processed(command.id):
            # Redémarrage du service après envoi : la commande ne rejoue pas.
            self._ack(command.id, COMMAND_COMPLETED, code="already_processed")
            return

        try:
            runtime = self._backend.instance_runtime(command.instance_id)
        except (BackendError, TransientBackendError) as exc:
            self._ack(command.id, COMMAND_FAILED, code="runtime_unreadable", message=type(exc).__name__)
            return

        if not runtime.get("runnable"):
            self._ack(
                command.id,
                COMMAND_REJECTED,
                code=str(runtime.get("reason", "not_runnable")),
                observed_state=InstanceState.ERROR.value,
            )
            self._halt_owner_instances(command.instance_id)
            return

        if command.type == "start":
            self._handle_start(command, runtime)
        elif command.type == "stop_new_entries":
            self._handle_stop_new_entries(command, runtime)
        elif command.type == "stop_strategy":
            self._handle_stop(command, runtime)
        elif command.type == "emergency_close":
            self._handle_emergency_close(command, runtime)
        elif command.type in ("update_parameters", "reload_policy"):
            self._handle_reload(command, runtime)
        else:
            self._ack(command.id, COMMAND_REJECTED, code="unknown_command_type")

    def _handle_start(self, command: Command, runtime: dict) -> None:
        self._ack(command.id, COMMAND_RECEIVED, code="received")
        instance_id = command.instance_id
        with self._lock:
            existing = self._instances.get(instance_id)
        try:
            instance = existing or self._runner.prepare(runtime)
        except (RegistryError, ValueError, KeyError) as exc:
            self._ack(
                command.id,
                COMMAND_REJECTED,
                code="preparation_refused",
                message=str(exc)[:200],
                observed_state=InstanceState.ERROR.value,
            )
            return

        if instance.state in (InstanceState.STARTING, InstanceState.RUNNING):
            # Idempotence : un second start ne double pas le démarrage (§13 T4).
            self._ack(
                command.id,
                COMMAND_COMPLETED,
                code="already_started",
                observed_state=instance.state.value,
            )
            with self._lock:
                self._instances[instance_id] = instance
            self._store.mark_processed(command.id, instance_id, command.type, "completed")
            return

        try:
            nonce = secrets.token_hex(8)
            self._runner.start(instance, nonce)
        except BridgeUnavailable as exc:
            instance.state = InstanceState.DISCONNECTED
            self._remember(instance)
            self._ack(
                command.id,
                COMMAND_FAILED,
                code="terminal_unavailable",
                message=str(exc)[:200],
                observed_state=InstanceState.DISCONNECTED.value,
            )
            return
        except RiskHalt as halt:
            instance.state = InstanceState.RISK_HALTED
            instance.new_entries_blocked = True
            self._remember(instance)
            self._ack(
                command.id,
                COMMAND_FAILED,
                code=halt.code,
                message=halt.detail[:200],
                observed_state=InstanceState.RISK_HALTED.value,
            )
            return
        except Exception as exc:
            instance.state = InstanceState.ERROR
            instance.last_error = type(exc).__name__
            self._remember(instance)
            self._ack(
                command.id,
                COMMAND_FAILED,
                code="start_error",
                message=type(exc).__name__,
                observed_state=InstanceState.ERROR.value,
            )
            return

        self._remember(instance)
        self._ack(command.id, COMMAND_ACCEPTED, code="validated")
        self._ack(
            command.id,
            COMMAND_STARTED,
            code="strategy_running",
            observed_state=InstanceState.RUNNING.value,
        )
        self._store.mark_processed(command.id, instance_id, command.type, "started")

    def _handle_stop_new_entries(self, command: Command, runtime: dict) -> None:
        self._ack(command.id, COMMAND_RECEIVED, code="received")
        instance = self._instance_for(command.instance_id, runtime)
        if instance is None:
            self._ack(command.id, COMMAND_FAILED, code="instance_not_loaded")
            return
        instance.new_entries_blocked = True
        self._remember(instance)
        self._publish_events(instance)
        self._ack(
            command.id,
            COMMAND_COMPLETED,
            code="new_entries_blocked",
            observed_state=instance.state.value,
        )
        self._store.mark_processed(command.id, command.instance_id, command.type, "completed")

    def _handle_stop(self, command: Command, runtime: dict) -> None:
        self._ack(command.id, COMMAND_RECEIVED, code="received")
        instance = self._instance_for(command.instance_id, runtime)
        if instance is None:
            self._ack(command.id, COMMAND_COMPLETED, code="not_loaded", observed_state=InstanceState.STOPPED.value)
            self._store.mark_processed(command.id, command.instance_id, command.type, "completed")
            return
        # Politique explicite : l'arrêt standard bloque les entrées et garde les
        # positions ouvertes ; la liquidation est une commande distincte (§7.2).
        close_existing = bool(command.payload.get("close_positions", False))
        try:
            self._runner.stop_strategy(instance, close_existing)
        except BridgeUnavailable as exc:
            instance.state = InstanceState.DISCONNECTED
            self._remember(instance)
            self._ack(
                command.id,
                COMMAND_FAILED,
                code="terminal_unavailable",
                message=str(exc)[:200],
                observed_state=InstanceState.DISCONNECTED.value,
            )
            return
        self._remember(instance)
        self._publish_events(instance)
        self._ack(
            command.id,
            COMMAND_COMPLETED,
            code="stopped",
            observed_state=InstanceState.STOPPED.value,
        )
        self._store.mark_processed(command.id, command.instance_id, command.type, "completed")

    def _handle_emergency_close(self, command: Command, runtime: dict) -> None:
        self._ack(command.id, COMMAND_RECEIVED, code="received")
        if command.payload.get("confirm_phrase") != "LIQUIDER":
            self._ack(command.id, COMMAND_REJECTED, code="confirmation_required")
            return
        instance = self._instance_for(command.instance_id, runtime)
        if instance is None:
            self._ack(command.id, COMMAND_COMPLETED, code="nothing_to_close", observed_state=InstanceState.STOPPED.value)
            self._store.mark_processed(command.id, command.instance_id, command.type, "completed")
            return
        try:
            self._runner.emergency_close(instance)
        except BridgeUnavailable as exc:
            self._ack(command.id, COMMAND_FAILED, code="terminal_unavailable", message=str(exc)[:200])
            return
        self._remember(instance)
        self._publish_events(instance)
        self._ack(
            command.id,
            COMMAND_COMPLETED,
            code="liquidated",
            observed_state=InstanceState.STOPPED.value,
            detail={"positions_closed": True},
        )
        self._store.mark_processed(command.id, command.instance_id, command.type, "completed")

    def _handle_reload(self, command: Command, runtime: dict) -> None:
        """Recharge paramètres ou politique, puis repart sur la version validée."""
        self._ack(command.id, COMMAND_RECEIVED, code="received")
        try:
            fresh = self._runner.prepare(runtime)
        except (RegistryError, ValueError, KeyError) as exc:
            self._ack(command.id, COMMAND_REJECTED, code="reload_refused", message=str(exc)[:200])
            return
        previous = self._instances.get(command.instance_id)
        if previous is not None and previous.state in LIVE_STATES:
            fresh.state = previous.state
            fresh.previous_loss_occurred = previous.previous_loss_occurred
            fresh.peak_equity = previous.peak_equity
            fresh.account_ref = previous.account_ref
            fresh.position_owners = previous.position_owners
        self._remember(fresh)
        self._ack(
            command.id,
            COMMAND_COMPLETED,
            code="reloaded",
            observed_state=fresh.state.value,
            detail={"parameters_digest": digest_of(fresh.parameters)},
        )
        self._store.mark_processed(command.id, command.instance_id, command.type, "completed")

    # ------------------------------------------------------------- exécution

    def tick_running_instances(self) -> None:
        with self._lock:
            instances = [
                instance
                for instance in self._instances.values()
                if instance.state in LIVE_STATES
            ]
        for instance in instances:
            try:
                self._runner.tick(instance)
            except ObjectiveReached as reached:
                self._stop_on_objective(instance, reached)
            except RiskHalt as halt:
                self._halt_instance(instance, halt)
            except BridgeUnavailable as exc:
                self._mark_disconnected(instance, exc)
            except Exception as exc:
                self._fail_instance(instance, exc)
            self._publish_events(instance)

        self.detect_stalled_instances()

    def _stop_on_objective(self, instance: InstanceRuntime, reached: ObjectiveReached) -> None:
        """Arrêt automatique sur objectif de gain, perte max ou quota (§7).

        Ordre des opérations imposé : blocage immédiat des entrées, événement
        avec motif, passage STOPPING, politique sur les positions, état final
        STOPPED. Aucune nouvelle entrée n'est possible dès la première étape.
        """
        instance.new_entries_blocked = True
        instance.record_event(
            "risk_block",
            result=reached.trigger,
            detail={
                "objective": True,
                "reason": reached.reason,
                "net": reached.net,
                "reference": instance.objective.reference,
            },
        )
        self._publish_events(instance)
        close_existing = instance.objective.stop_policy == "close_positions"
        try:
            self._runner.stop_strategy(instance, close_existing)
        except BridgeUnavailable as exc:
            self._mark_disconnected(instance, exc)
        self._remember(instance)
        self._publish_events(instance)
        log_fields(
            "warning",
            "arrêt automatique sur objectif",
            {
                "instance_id": instance.instance_id,
                "trigger": reached.trigger,
                "net": reached.net,
            },
        )

    def _halt_instance(self, instance: InstanceRuntime, halt: RiskHalt) -> None:
        instance.new_entries_blocked = True
        instance.state = InstanceState.RISK_HALTED
        instance.last_error = halt.code
        instance.record_event("risk_block", result=halt.code)
        self._remember(instance)
        log_fields(
            "warning",
            "arrêt automatique après dépassement d'une limite",
            {"instance_id": instance.instance_id, "code": halt.code},
        )
        try:
            self._bridge.forget_secret(instance.account_ref)
        except Exception:
            pass

    def _mark_disconnected(self, instance: InstanceRuntime, exc: Exception) -> None:
        if instance.state is InstanceState.DISCONNECTED:
            return
        instance.state = InstanceState.DISCONNECTED
        instance.new_entries_blocked = True
        instance.last_error = type(exc).__name__
        self._remember(instance)

    def _fail_instance(self, instance: InstanceRuntime, exc: Exception) -> None:
        instance.state = InstanceState.ERROR
        instance.new_entries_blocked = True
        instance.last_error = type(exc).__name__
        instance.record_event("engine_error", result=type(exc).__name__)
        self._remember(instance)
        log_fields(
            "error",
            "erreur moteur",
            {"instance_id": instance.instance_id, "error_type": type(exc).__name__},
        )

    def detect_stalled_instances(self) -> None:
        """Terminal injoignable : les instances actives passent en DISCONNECTED (§7.2)."""
        if self.safe_ping():
            return
        with self._lock:
            targets = [
                instance
                for instance in self._instances.values()
                if instance.state in LIVE_STATES
            ]
        for instance in targets:
            self._mark_disconnected(instance, BridgeUnavailable("terminal injoignable"))

    # ------------------------------------------------------------ publication

    def _publish_events(self, instance: InstanceRuntime) -> None:
        with self._lock:
            events = instance.events[:]
            instance.events.clear()
        positions = self._position_payload(instance)
        if not events and not positions and not instance.last_account:
            return
        self._store.enqueue(
            "events",
            {
                "events": events,
                "positions": positions,
                "account": instance.last_account,
            },
            instance.account_id,
            instance.instance_id,
        )

    def _position_payload(self, instance: InstanceRuntime) -> list[dict]:
        try:
            records = self._bridge.positions(instance.account_ref)
        except BridgeUnavailable:
            return []
        observed = datetime.now(timezone.utc).isoformat()
        return [
            {
                "position_id": record.position_id,
                "symbol": record.symbol,
                "side": record.side,
                "volume": record.volume,
                "open_price": record.open_price,
                "current_price": record.current_price,
                "profit": record.profit,
                "margin": record.margin,
                "observed_at": observed,
            }
            for record in records
            if _belongs_to_instance(record, instance)
        ]

    def flush_outbox(self) -> None:
        for item in self._store.next_outbox():
            body = dict(item.body)
            try:
                self._backend.push_events(
                    item.account_id or "",
                    item.instance_id,
                    body.get("events", []),
                    body.get("positions", []),
                    body.get("account") or None,
                )
            except (BackendError, TransientBackendError):
                self._store.bump_outbox_attempts(item.id)
                return
            self._store.delete_outbox(item.id)

    # ---------------------------------------------------------------- utilitaire

    def _instance_for(self, instance_id: str, runtime: dict) -> InstanceRuntime | None:
        with self._lock:
            instance = self._instances.get(instance_id)
        if instance is not None:
            return instance
        try:
            prepared = self._runner.prepare(runtime)
        except (RegistryError, ValueError, KeyError):
            return None
        with self._lock:
            self._instances[instance_id] = prepared
        return prepared

    def _remember(self, instance: InstanceRuntime) -> None:
        with self._lock:
            self._instances[instance.instance_id] = instance
        self._runner.persist(instance)

    def _halt_owner_instances(self, instance_id: str) -> None:
        """Licence ou version non valables : aucune nouvelle entrée (§11)."""
        with self._lock:
            instance = self._instances.get(instance_id)
        if instance is not None:
            instance.new_entries_blocked = True

    def drain_connection_tests(self) -> int:
        """Tests de connexion demandés par l'interface, exécutés côté moteur (§8)."""
        executed = 0
        for test in self._backend.pending_connection_tests():
            account_id = str(test["account_id"])
            ref = AccountRef(
                account_id=account_id,
                server=str(test["server"]),
                login=str(test["login"]),
                environment=str(test.get("environment", "demo")),
            )
            try:
                password = self._backend.reveal_secret(account_id, "test_connection", secrets.token_hex(8))
            except (BackendError, TransientBackendError):
                self._backend.ack_connection_test(
                    str(test["connection_test_id"]), "failed", "secret_unavailable", "secret indisponible"
                )
                continue
            try:
                result: ConnectionResult = self._bridge.connect(ref, password)
            except BridgeUnavailable as exc:
                result = ConnectionResult(False, "terminal_unavailable", str(exc)[:200])
            finally:
                del password
                self._bridge.forget_secret(ref)
            status = "connected" if result.connected else "failed"
            self._backend.ack_connection_test(
                str(test["connection_test_id"]), status, result.code, result.message
            )
            executed += 1
        return executed

    def shutdown(self) -> None:
        self._stop.set()
        with self._lock:
            instances = list(self._instances.values())
        for instance in instances:
            try:
                instance.strategy.on_stop(instance_snapshot_context(instance))
            except Exception:
                pass
        self._bridge.shutdown()
        self._backend.close()
        self._store.close()
        log_fields("info", "moteur arrêté", {"instances": len(instances)})

    def request_stop(self) -> None:
        self._stop.set()

    def _install_signal_handlers(self) -> None:
        def handler(signum, frame):  # noqa: ANN001 - signature imposée par signal
            log_fields("info", "signal d'arrêt reçu", {"signal": signum})
            self._stop.set()

        for name in ("SIGTERM", "SIGINT"):
            number = getattr(signal, name, None)
            if number is not None and threading.current_thread() is threading.main_thread():
                try:
                    signal.signal(number, handler)
                except ValueError:
                    # Impossible hors thread principal (tests, services Windows).
                    continue

    # ------------------------------------------------------------- exposition test

    @property
    def instances(self) -> dict[str, InstanceRuntime]:
        return self._instances

    @property
    def bridge(self) -> TerminalBridge:
        return self._bridge

    @property
    def store(self) -> EngineStore:
        return self._store

    def instance_context(self, instance: InstanceRuntime) -> StrategyContext:
        return instance_snapshot_context(instance)

def digest_of(parameters: dict) -> str:
    return parameters_digest(parameters)


def build_bridge(config: EngineConfig) -> TerminalBridge:
    """Choix de l'exécutant selon l'environnement réel (§4).

    Un VPS Linux ne peut pas importer le paquet MetaTrader5 : le pont Windows
    agent ou le simulateur sont les deux seules options.
    """
    if config.terminal_kind == "windows_bridge":
        from .bridge.windows_agent_client import WindowsAgentBridge

        return WindowsAgentBridge(config.bridge_url, config.bridge_token, config.request_timeout_seconds)
    from .bridge.simulator import SimulatorBridge

    return SimulatorBridge()


__all__ = ["Supervisor", "SupervisorStatus", "build_bridge", "ENGINE_VERSION"]
