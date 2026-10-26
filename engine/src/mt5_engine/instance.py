"""Exécuteur d'une instance de stratégie (§7, §8.1, §11).

Le runner est le seul endroit qui puisse produire un ordre. Entre le signal de
la stratégie et l'envoi au pont terminal, chaque ordre franchit, dans cet
ordre :

1. résolution du symbole pour ce broker (§6) ;
2. calcul du volume de référence sur l'équité **courante** (§6.1) ;
3. garde-fou anti-Martingale (§6.1) ;
4. contrôles de risque du profil : perte journalière, drawdown, marge, spread,
   nombre de positions, exposition totale, plafond de lot (§7.1) ;
5. envoi au pont, puis publication de l'événement réellement observé (§14).

Aucune de ces étapes n'utilise l'historique des pertes pour augmenter un lot.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from .anti_martingale import AntiMartingaleInput, Position, assert_no_martingale
from .backend_client import BackendClient
from .bridge.base import (
    AccountRef,
    BridgeUnavailable,
    OrderRequest,
    TerminalBridge,
)
from .logs import get_logger, log_fields
from .objectives import (
    ObjectiveEvaluation,
    ObjectiveLimits,
    evaluate_objectives,
    session_net,
)
from .parameters import validate_parameters
from .risk import (
    AccountSnapshot,
    RiskCheck,
    RiskLimits,
    SymbolSnapshot,
    TradeIntent,
    check_pre_trade,
)
from .states import InstanceState, LIVE_STATES, parse_state, transition_allowed
from .store import EngineStore
from .strategy.base import Signal, StrategyBase, StrategyContext, symbol_aliases_for_broker
from .strategy.registry import RegistryError, resolve_strategy
from .volume import LotConstraints, VolumeInputs, compute_base_volume, from_scaled, to_scaled

log = get_logger("mt5_engine.instance")

ORDER_SENT = "order_sent"
ORDER_ACCEPTED = "order_accepted"
ORDER_REJECTED = "order_rejected"
POSITION_OPENED = "position_opened"
POSITION_CLOSED = "position_closed"
RISK_BLOCK = "risk_block"
ENGINE_ERROR = "engine_error"
RECONNECT = "reconnect"


@dataclass
class InstanceRuntime:
    """État vif d'une instance dans le processus moteur."""

    instance_id: str
    owner_user_id: str
    account_id: str
    account_ref: AccountRef
    mode: str
    symbols: list[str]
    parameters: dict
    limits: RiskLimits
    strategy: StrategyBase
    logical_to_broker: dict[str, str]
    magic: int | None = None
    objective: ObjectiveLimits = ObjectiveLimits()
    settings: dict = field(default_factory=dict)
    # Références de résultat : équité au démarrage de la session et du jour.
    session_start_equity: str | None = None
    day_start_equity: str | None = None
    day_key: str = ""
    session_trades: int = 0
    last_account: dict = field(default_factory=dict)
    state: InstanceState = InstanceState.STOPPED
    new_entries_blocked: bool = False
    previous_loss_occurred: bool = False
    peak_equity: str = "0"
    position_owners: dict[str, str] = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    last_error: str | None = None

    def record_event(self, event_type: str, **fields) -> None:
        # Les détails journalisés passent par le masque du handler ; aucun champ
        # sensible n'est ajouté ici (§9.1, §10).
        self.events.append(
            {
                "event_type": event_type,
                "occurred_at": datetime.now(timezone.utc).isoformat(),
                **fields,
            }
        )


class InstanceRunner:
    def __init__(
        self,
        backend: BackendClient,
        bridge: TerminalBridge,
        store: EngineStore,
        command_max_age_seconds: int = 110,
    ) -> None:
        self._backend = backend
        self._bridge = bridge
        self._store = store
        self._max_age = command_max_age_seconds

    # ---------------------------------------------------------------- démarrage

    def prepare(self, runtime: dict) -> InstanceRuntime:
        """Construit l'exécutif depuis la réponse `/engine/instances/{id}/runtime`.

        Toute incohérence entre la base et le code déployé est un refus de
        démarrage, jamais un ajustement implicite (§6, §8.1).
        """
        instance_id = str(runtime["instance_id"])
        strategy_block = runtime["strategy"]
        slug = str(strategy_block["slug"])
        version = str(strategy_block["version"])

        if bool(strategy_block.get("martingale_allowed")):
            raise RegistryError(f"{slug}@{version}: martingale interdit par conception (§6.1)")

        declared_digest = str(strategy_block.get("artifact_digest", ""))
        if declared_digest and runtime.get("artifact_digest") not in (None, declared_digest):
            raise RegistryError(
                f"{slug}@{version}: empreinte d'artefact divergente, démarrage refusé (§6)"
            )

        cls = resolve_strategy(slug, version)
        parameter_schema = strategy_block.get("parameter_schema") or {}
        validation = validate_parameters(parameter_schema, runtime.get("parameters") or {})
        if not validation.ok:
            keys = ",".join(sorted({issue.key for issue in validation.issues}))
            raise ValueError(f"paramètres hors limites: {keys}")

        account = runtime["account"]
        supported = list(strategy_block.get("supported_symbols") or [])
        logical_to_broker = symbol_aliases_for_broker(
            dict(strategy_block.get("symbol_aliases") or {}), supported, str(account["broker"])
        )
        # Une instance ne négocie que les symboles configurés : le mapping
        # complet du catalogue ne doit pas ouvrir quatre marchés à la fois.
        selected = {
            str(symbol).strip().upper()
            for symbol in (runtime.get("symbols") or [])
            if str(symbol).strip()
        }
        if selected:
            logical_to_broker = {
                logical: broker
                for logical, broker in logical_to_broker.items()
                if logical in selected
            }

        if str(account.get("environment")) == "real":
            if not bool(account.get("real_authorized")) or str(runtime.get("mode")) != "real":
                raise ValueError(
                    "mode réel non autorisé pour ce compte (approbation explicite requise)"
                )

        ref = AccountRef(
            account_id=str(account["id"]),
            server=str(account["server"]),
            login=str(account["login"]),
            environment=str(account["environment"]),
        )
        strategy = cls(validation.values)
        objective = ObjectiveLimits.from_runtime(dict(runtime.get("objective") or {}))
        settings = dict(runtime.get("settings") or {})

        runtime_state = InstanceState.STOPPED
        stored = self._store.get_instance(instance_id)
        if stored:
            runtime_state = parse_state(str(stored["state"]))

        instance = InstanceRuntime(
            instance_id=instance_id,
            owner_user_id=str(runtime["owner_user_id"]),
            account_id=ref.account_id,
            account_ref=ref,
            mode=str(runtime["mode"]),
            symbols=list(runtime.get("symbols") or []),
            parameters=validation.values,
            limits=RiskLimits.from_runtime(dict(runtime.get("risk") or {})),
            strategy=strategy,
            logical_to_broker=logical_to_broker,
            magic=int(runtime["magic_number"]) if runtime.get("magic_number") is not None else None,
            objective=objective,
            settings=settings,
            state=runtime_state,
            previous_loss_occurred=bool(
                (stored or {}).get("previous_loss_occurred", False)
            ),
            peak_equity=str((stored or {}).get("peak_equity", "0")),
        )
        return instance

    # ------------------------------------------------------------------ connexions

    def open_session(self, instance: InstanceRuntime, nonce: str) -> None:
        """Demande le secret sur le canal de service, l'utilise, l'oublie (§10)."""
        password = self._backend.reveal_secret(instance.account_id, "connect", nonce)
        try:
            result = self._bridge.connect(instance.account_ref, password)
        finally:
            # Référence locale coupée : le secret ne reste pas dans l'instance.
            del password
            self._bridge.forget_secret(instance.account_ref)
        if not result.connected:
            raise BridgeUnavailable(f"connexion refusée: {result.code}")
        instance.record_event(RECONNECT, result=result.code)

    def snapshot(self, instance: InstanceRuntime) -> tuple[AccountSnapshot, dict[str, SymbolSnapshot]]:
        """Lit l'état réel dans le terminal ; jamais dans la stratégie (§7.1)."""
        info = self._bridge.account_info(instance.account_ref)
        records = self._bridge.positions(instance.account_ref)
        positions: list[Position] = []
        for record in records:
            if not _belongs_to_instance(record, instance):
                # Politique d'attribution : une position sans magic ni préfixe
                # reconnu n'est jamais comptée ni fermée par ce robot (§13 T8).
                continue
            symbol_info = self._bridge.symbol_info(instance.account_ref, record.symbol)
            positions.append(
                Position(
                    volume=record.volume,
                    open_price=record.open_price,
                    contract_size=symbol_info.contract_size,
                    symbol=record.symbol,
                    side=record.side,
                    position_id=record.position_id,
                )
            )

        account_snapshot = AccountSnapshot(
            equity=info.equity,
            balance=info.balance,
            margin_level_pct=info.margin_level_pct,
            daily_realized_pnl=self._day_net(instance, info.equity),
            peak_equity=self._track_peak(instance, info.equity),
            open_positions=tuple(positions),
        )

        instance.last_account = {
            "account_id": instance.account_id,
            "equity": info.equity,
            "balance": info.balance,
            "margin_level_pct": info.margin_level_pct,
            "currency": info.currency,
        }

        symbols: dict[str, SymbolSnapshot] = {}
        for broker_symbol in set(instance.logical_to_broker.values()):
            raw = self._bridge.symbol_info(instance.account_ref, broker_symbol)
            symbols[raw.symbol.upper()] = SymbolSnapshot(
                symbol=raw.symbol.upper(),
                spread_points=raw.spread_points,
                min_lot=raw.min_lot,
                max_lot=raw.max_lot,
                lot_step=raw.lot_step,
                point_value_per_lot=raw.point_value_per_lot,
                digits=raw.digits,
                contract_size=raw.contract_size,
                trading_enabled=raw.trading_enabled,
            )
        return account_snapshot, symbols

    def _track_peak(self, instance: InstanceRuntime, equity: str) -> str:
        current = to_scaled(equity)
        peak = to_scaled(instance.peak_equity or "0")
        if current > peak:
            instance.peak_equity = equity
        return instance.peak_equity

    def _day_net(self, instance: InstanceRuntime, equity: str) -> str:
        """Résultat net depuis le début du jour observé (équité de référence)."""
        self._ensure_day(instance, equity)
        if instance.day_start_equity is None:
            return "0"
        return session_net(equity, instance.day_start_equity)

    def _ensure_day(self, instance: InstanceRuntime, equity: str) -> None:
        today = datetime.now(timezone.utc).date().isoformat()
        if instance.day_key != today or instance.day_start_equity is None:
            instance.day_key = today
            instance.day_start_equity = equity

    def evaluate_objectives(
        self, instance: InstanceRuntime, account: AccountSnapshot
    ) -> ObjectiveEvaluation:
        """Évalue l'objectif configuré sur l'équité réelle (§7)."""
        baseline = (
            instance.session_start_equity
            if instance.objective.reference == "session"
            else instance.day_start_equity
        )
        if baseline is None:
            return ObjectiveEvaluation(None, "0", "")
        net = (
            session_net(account.equity, baseline)
            if instance.objective.reference == "session"
            else self._day_net(instance, account.equity)
        )
        return evaluate_objectives(instance.objective, net, instance.session_trades)

    # --------------------------------------------------------------------- ticks

    def tick(self, instance: InstanceRuntime) -> None:
        if instance.state not in LIVE_STATES or instance.new_entries_blocked:
            return
        account_snapshot, symbols = self.snapshot(instance)
        evaluation = self.evaluate_objectives(instance, account_snapshot)
        if evaluation.reached:
            raise ObjectiveReached(evaluation)
        context = StrategyContext(
            instance_id=instance.instance_id,
            mode=instance.mode,
            parameters=instance.parameters,
            limits=instance.limits,
            account=account_snapshot,
            symbols=symbols,
            logical_to_broker=instance.logical_to_broker,
            allowed_hours=dict(instance.settings.get("allowed_hours") or {}),
            rates=self._rates(instance),
        )
        for signal in instance.strategy.tick(context):
            if signal.action == "open":
                self._execute_open(instance, signal, account_snapshot, symbols)
            elif signal.action == "close":
                self._execute_close(instance, signal)

    def _rates(self, instance: InstanceRuntime) -> dict[str, tuple]:
        timeframe = str(instance.settings.get("timeframe", "M15"))
        rates: dict[str, tuple] = {}
        for broker_symbol in set(instance.logical_to_broker.values()):
            candles = self._bridge.rates(
                instance.account_ref, broker_symbol, timeframe, 320
            )
            rates[broker_symbol.upper()] = tuple(candles)
        return rates

    def _execute_open(
        self,
        instance: InstanceRuntime,
        signal: Signal,
        account: AccountSnapshot,
        symbols: dict[str, SymbolSnapshot],
    ) -> None:
        broker_symbol = instance.logical_to_broker.get((signal.logical_symbol or "").upper())
        if broker_symbol is None:
            instance.record_event(
                RISK_BLOCK, result="symbol_unresolved", symbol=signal.logical_symbol
            )
            return
        symbol = symbols.get(broker_symbol.upper())
        if symbol is None:
            instance.record_event(RISK_BLOCK, result="symbol_unavailable", symbol=broker_symbol)
            return

        stop_points = int(signal.stop_distance_points or 0)
        if stop_points <= 0:
            # Stop obligatoire : un ordre sans distance de risque n'est pas envoyé (§7.1).
            instance.record_event(RISK_BLOCK, result="stop_required", symbol=broker_symbol)
            return

        lot = LotConstraints(symbol.min_lot, symbol.max_lot, symbol.lot_step)
        baseline = compute_base_volume(
            VolumeInputs(
                equity=account.equity,
                risk_per_trade_pct=str(instance.parameters.get("lot_risk_pct", "0")),
                stop_distance_points=stop_points,
                point_value_per_lot=symbol.point_value_per_lot,
                lot=lot,
            )
        )
        if baseline.volume is None:
            instance.record_event(
                RISK_BLOCK, result=f"volume_{baseline.rejected_reason}", symbol=broker_symbol
            )
            return

        requested = _apply_fraction(baseline.volume, signal.max_lot_fraction, lot.lot_step)
        # Le lot initial configuré plafonne le volume : il ne peut jamais servir
        # de multiplicateur après une perte (§6.1).
        requested = _cap_to_ceiling(
            requested, str(instance.settings.get("initial_lot", "0")), lot
        )
        duplicate = any(
            position.symbol == broker_symbol.upper() for position in account.open_positions
        )

        decision = assert_no_martingale(_anti_input(requested, baseline.volume, instance, lot, duplicate))
        if not decision.allowed:
            instance.record_event(
                RISK_BLOCK, result="anti_martingale", symbol=broker_symbol, detail={"reason": decision.reason}
            )
            log_fields(
                "warning",
                "ordre refusé par le garde-fou anti-Martingale",
                {"instance_id": instance.instance_id, "symbol": broker_symbol, "reason": decision.reason},
            )
            return

        check: RiskCheck = check_pre_trade(
            instance.limits,
            account,
            symbol,
            _intent(requested, baseline.volume, instance.previous_loss_occurred, duplicate),
        )
        if not check.allowed:
            instance.record_event(
                RISK_BLOCK,
                result=check.code,
                symbol=broker_symbol,
                detail={"detail": check.detail},
            )
            if check.halt_required:
                raise RiskHalt(check.code or "risk_block", check.detail or "")

        instance.record_event(ORDER_SENT, symbol=broker_symbol, volume=requested)
        result = self._bridge.send_order(
            instance.account_ref,
            OrderRequest(
                side=signal.side or "buy",
                symbol=broker_symbol,
                volume=requested,
                action="new",
                stop_loss_points=stop_points,
                comment=f"inst:{instance.instance_id[:8]}",
                instance_id=instance.instance_id,
                magic=instance.magic,
            ),
        )
        if not result.accepted:
            instance.record_event(
                ORDER_REJECTED, symbol=broker_symbol, retcode=result.retcode, result=result.message
            )
            return

        instance.session_trades += 1
        if result.ticket:
            instance.position_owners[result.ticket] = instance.instance_id
        instance.record_event(
            ORDER_ACCEPTED,
            symbol=broker_symbol,
            volume=result.volume or requested,
            price=result.price,
            broker_ticket=result.ticket,
            retcode=result.retcode,
        )

    def _execute_close(self, instance: InstanceRuntime, signal: Signal) -> None:
        if not signal.position_id:
            return
        result = self._bridge.close_position(instance.account_ref, signal.position_id)
        if result.accepted:
            realized = str(result.details.get("realized", "0"))
            if to_scaled(realized) < 0:
                # Le drapeau de perte ne sert qu'à refuser une hausse de lot (§6.1).
                instance.previous_loss_occurred = True
                self._store.note_loss_occurred(instance.instance_id)
            instance.record_event(
                POSITION_CLOSED,
                broker_ticket=signal.position_id,
                volume=result.volume,
                price=result.price,
                result=realized,
            )
        else:
            instance.record_event(
                ORDER_REJECTED, broker_ticket=signal.position_id, retcode=result.retcode
            )

    # --------------------------------------------------------- commandes applicables

    def start(self, instance: InstanceRuntime, nonce: str) -> None:
        self.open_session(instance, nonce)
        info = self._bridge.account_info(instance.account_ref)
        instance.session_start_equity = info.equity
        instance.day_start_equity = info.equity
        instance.day_key = datetime.now(timezone.utc).date().isoformat()
        instance.session_trades = 0
        instance.new_entries_blocked = False
        self._transition(instance, InstanceState.STARTING)
        instance.strategy.on_start(instance_snapshot_context(instance))
        self._transition(instance, InstanceState.RUNNING)

    def stop_new_entries(self, instance: InstanceRuntime) -> None:
        """Arrêt des nouvelles entrées, positions existantes conservées (§7.2)."""
        instance.new_entries_blocked = True

    def stop_strategy(self, instance: InstanceRuntime, close_existing: bool) -> None:
        instance.new_entries_blocked = True
        if instance.state in (InstanceState.STOPPED,):
            return
        self._transition(instance, InstanceState.STOPPING)
        if close_existing:
            self._close_all(instance)
        instance.strategy.on_stop(None)
        try:
            self._bridge.disconnect(instance.account_ref)
        except BridgeUnavailable:
            pass
        self._transition(instance, InstanceState.STOPPED)

    def emergency_close(self, instance: InstanceRuntime) -> None:
        """Liquidation d'urgence distincte de l'arrêt standard (§7.2).

        Possible depuis tout état non arrete, y compris ERROR, RISK_HALTED ou
        DISCONNECTED : aucune position ne reste sans proprietaire.
        """
        instance.new_entries_blocked = True
        if instance.state is InstanceState.STOPPED:
            return
        instance.state = InstanceState.STOPPING
        self.persist(instance)
        self._close_all(instance)
        instance.strategy.on_stop(None)
        try:
            self._bridge.disconnect(instance.account_ref)
        except BridgeUnavailable:
            pass
        self._transition(instance, InstanceState.STOPPED)

    def _close_all(self, instance: InstanceRuntime) -> None:
        for record in self._bridge.positions(instance.account_ref):
            if not _belongs_to_instance(record, instance):
                continue
            result = self._bridge.close_position(instance.account_ref, record.position_id)
            if result.accepted:
                instance.record_event(POSITION_CLOSED, broker_ticket=record.position_id)
            else:
                instance.record_event(
                    ENGINE_ERROR,
                    result="close_failed",
                    broker_ticket=record.position_id,
                    retcode=result.retcode,
                )

    def _transition(self, instance: InstanceRuntime, target: InstanceState) -> None:
        if instance.state is target:
            return
        if not transition_allowed(instance.state, target):
            # Le moteur ne s'invente pas d'état : il signale et se met en ERROR.
            log_fields(
                "error",
                "transition d'état refusée par le moteur",
                {
                    "instance_id": instance.instance_id,
                    "from": instance.state.value,
                    "to": target.value,
                },
            )
            instance.state = InstanceState.ERROR
            instance.last_error = f"transition_refusée:{target.value}"
            return
        instance.state = target
        self.persist(instance)

    def persist(self, instance: InstanceRuntime) -> None:
        self._store.upsert_instance(
            instance_id=instance.instance_id,
            owner_user_id=instance.owner_user_id,
            account_id=instance.account_id,
            state=instance.state.value,
            previous_loss_occurred=instance.previous_loss_occurred,
            peak_equity=instance.peak_equity,
        )


class RiskHalt(RuntimeError):
    """Seuil de risque atteint : l'instance doit passer en RISK_HALTED (§7.2)."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail or code)
        self.code = code
        self.detail = detail


def _anti_input(
    requested: str, baseline: str, instance: InstanceRuntime, lot: LotConstraints, duplicate: bool
) -> AntiMartingaleInput:
    return AntiMartingaleInput(
        requested_volume=requested,
        baseline_volume=baseline,
        previous_loss_occurred=instance.previous_loss_occurred,
        duplicate_of_open_position=duplicate,
        lot=lot,
        max_lot_per_trade=instance.limits.max_lot_size,
    )


def _intent(
    requested: str, baseline: str, previous_loss_occurred: bool, duplicate: bool
) -> TradeIntent:
    return TradeIntent(
        requested_volume=requested,
        baseline_volume=baseline,
        previous_loss_occurred=previous_loss_occurred,
        duplicate_of_open_position=duplicate,
    )


def _apply_fraction(volume: str, fraction: float, lot_step: str) -> str:
    """Réduit le volume de référence sans jamais l'augmenter (§6.1)."""
    if fraction >= 1:
        return volume
    if fraction <= 0:
        return volume
    scaled = to_scaled(volume)
    step = to_scaled(lot_step)
    reduced = (int(scaled * fraction) // step) * step
    if reduced <= 0:
        return volume
    return from_scaled(reduced)


def instance_snapshot_context(instance: InstanceRuntime) -> StrategyContext:
    """Contexte minimal remis à `on_start`, sans aucun moyen d'exécuter un ordre."""
    account = AccountSnapshot(
        equity=instance.peak_equity or "0",
        balance="0",
        margin_level_pct="0",
        daily_realized_pnl="0",
        peak_equity=instance.peak_equity or "0",
        open_positions=(),
    )
    return StrategyContext(
        instance_id=instance.instance_id,
        mode=instance.mode,
        parameters=instance.parameters,
        limits=instance.limits,
        account=account,
        symbols={},
        logical_to_broker=instance.logical_to_broker,
    )


class ObjectiveReached(RuntimeError):
    """Objectif de gain, perte maximale ou quota de trades atteint (§7)."""

    def __init__(self, evaluation: ObjectiveEvaluation) -> None:
        super().__init__(evaluation.reason or "objectif atteint")
        self.trigger = evaluation.triggered or "objective"
        self.net = evaluation.net
        self.reason = evaluation.reason
        self.evaluation = evaluation


def _belongs_to_instance(record, instance: InstanceRuntime) -> bool:
    """Politique d'attribution explicite (§13 T8).

    - magic identique : propriétaire certain ;
    - sinon, commentaire `inst:<préfixe>` correspondant à l'identifiant ;
    - sinon la position est non attribuée : elle n'est jamais fermée par un
      robot et n'entre pas dans son exposition. Elle reste visible dans MT5 et
      doit être surveillée manuellement.
    """
    if instance.magic is not None and record.magic is not None:
        # Le magic number est autoritaire : un magic différent écarte la
        # position, même si un commentaire ressemble au nôtre.
        return int(record.magic) == int(instance.magic)
    token = (record.instance_id or "").strip()
    if not token:
        return False
    return instance.instance_id == token or instance.instance_id.startswith(token)


def _cap_to_ceiling(volume: str, ceiling: str, lot: LotConstraints) -> str:
    """Plafonne un volume sans jamais l'augmenter."""
    try:
        limit = to_scaled(ceiling)
    except Exception:
        return volume
    if limit <= 0:
        return volume
    value = to_scaled(volume)
    if value <= limit:
        return volume
    step = to_scaled(lot.lot_step)
    capped = (limit // step) * step
    if capped <= 0:
        return volume
    return from_scaled(capped)
