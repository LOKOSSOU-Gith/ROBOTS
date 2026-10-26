"""T4/T5/T7 — superviseur, idempotence, états et objectifs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from mt5_engine.backend_client import Command
from mt5_engine.bridge.base import AccountRef, PositionRecord
from mt5_engine.bridge.simulator import SimulatorBridge
from mt5_engine.config import EngineConfig
from mt5_engine.instance import _belongs_to_instance
from mt5_engine.objectives import ObjectiveLimits
from mt5_engine.states import InstanceState
from mt5_engine.store import EngineStore
from mt5_engine.strategy.registry import load_builtin_strategies
from mt5_engine.supervisor import Supervisor

INSTANCE_ID = "11111111-1111-1111-1111-111111111111"
ACCOUNT_ID = "22222222-2222-2222-2222-222222222222"


def runtime(environment: str = "demo", real_authorized: bool = False) -> dict:
    return {
        "instance_id": INSTANCE_ID,
        "owner_user_id": "33333333-3333-3333-3333-333333333333",
        "mode": "real" if environment == "real" else "demo",
        "symbols": ["XAUUSD"],
        "parameters": {
            "lot_risk_pct": 0.25,
            "stop_distance_points": 250,
            "fast_ema": 3,
            "slow_ema": 21,
            "session_filter": "any",
            "use_trailing_stop": False,
        },
        "artifact_digest": "sha256:scalp-momentum-v1",
        "magic_number": 740001,
        "runnable": True,
        "account": {
            "id": ACCOUNT_ID,
            "broker": "Simulateur",
            "server": "Sim-Demo",
            "login": "12345678",
            "environment": environment,
            "real_authorized": real_authorized,
        },
        "strategy": {
            "slug": "scalp-momentum",
            "version": "1.0.0",
            "parameter_schema": {
                "lot_risk_pct": {"type": "number", "default": 0.25, "min": 0.01, "max": 1},
                "stop_distance_points": {
                    "type": "integer",
                    "default": 250,
                    "min": 100,
                    "max": 2000,
                },
                "fast_ema": {"type": "integer", "default": 9, "min": 3, "max": 50},
                "slow_ema": {"type": "integer", "default": 21, "min": 10, "max": 200},
                "session_filter": {
                    "type": "enum",
                    "options": ["asian", "london", "new_york", "any"],
                    "default": "any",
                },
                "use_trailing_stop": {"type": "boolean", "default": False},
            },
            "supported_symbols": ["XAUUSD"],
            "symbol_aliases": {},
            "risk_constraints": {"requires_stop_loss": True},
            "martingale_allowed": False,
            "artifact_digest": "sha256:scalp-momentum-v1",
        },
        "risk": {
            "max_daily_loss": "20",
            "max_drawdown_pct": "10",
            "max_open_positions": 1,
            "max_total_exposure": "20000",
            "max_spread_points": 50,
            "min_margin_level_pct": "200",
            "max_risk_per_trade_pct": "0.5",
            "max_lot_size": "0.10",
            "forbid_lot_increase_after_loss": True,
        },
        "objective": {
            "profit_target_net": "10",
            "max_loss_net": "5",
            "reference": "session",
            "stop_policy": "keep_positions",
            "max_trades": 100,
        },
        "settings": {
            "symbol": "XAUUSD",
            "timeframe": "M15",
            "initial_lot": "0.01",
            "max_positions": 1,
            "max_spread_points": 50,
            "allowed_hours": {"start": 0, "end": 24},
        },
    }


class FakeBackend:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.commands: list[Command] = []
        self.acks: list[dict] = []
        self.pushes: list[dict] = []
        self.heartbeats: list[dict] = []

    def heartbeat(self, payload: dict) -> dict:
        self.heartbeats.append(payload)
        return {"licenses": {}}

    def next_command(self):
        return self.commands.pop(0) if self.commands else None

    def ack(self, command_id: str, ack: str, **kwargs):
        self.acks.append({"command_id": command_id, "ack": ack, **kwargs})
        return {}

    def instance_runtime(self, instance_id: str) -> dict:
        return self.payload

    def reveal_secret(self, account_id: str, purpose: str, nonce: str) -> str:
        return "demo-password"

    def push_events(self, account_id, instance_id, events, positions, account=None):
        self.pushes.append(
            {
                "account_id": account_id,
                "instance_id": instance_id,
                "events": events,
                "positions": positions,
                "account": account,
            }
        )
        return {}

    def pending_connection_tests(self):
        return []

    def close(self):
        pass


def make_command(command_type: str, suffix: str = "1") -> Command:
    return Command(
        id=f"44444444-4444-4444-4444-44444444444{suffix}",
        instance_id=INSTANCE_ID,
        type=command_type,
        payload={},
        expires_at=(datetime.now(timezone.utc) + timedelta(seconds=100)).isoformat(),
        attempt=1,
    )


@pytest.fixture()
def setup(tmp_path):
    load_builtin_strategies()
    bridge = SimulatorBridge(initial_balance="10000")
    config = EngineConfig(
        backend_url="https://backend.example",
        engine_id="engine-test",
        auth_secret="x" * 32,
    )
    store = EngineStore(str(tmp_path))
    backend = FakeBackend(runtime())
    supervisor = Supervisor(config=config, bridge=bridge, backend=backend, store=store)
    yield supervisor, bridge, backend, store
    store.close()


def start_instance(supervisor: Supervisor, bridge: SimulatorBridge) -> None:
    supervisor.handle_command(make_command("start"))
    assert supervisor.instances[INSTANCE_ID].state is InstanceState.RUNNING


def test_start_stop_and_duplicate_start(setup):
    supervisor, bridge, backend, _store = setup
    start_instance(supervisor, bridge)

    codes = [ack["ack"] for ack in backend.acks]
    assert codes[:3] == ["received", "accepted", "started"]
    assert len(supervisor.instances) == 1

    # Un second start, avec une autre commande, ne redémarre pas.
    supervisor.handle_command(make_command("start", suffix="2"))
    assert backend.acks[-1]["ack"] == "completed"
    assert backend.acks[-1]["code"] == "already_started"
    assert len(supervisor.instances) == 1

    # La même commande rejouée après redémarrage est ignorée.
    supervisor.handle_command(make_command("start"))
    assert backend.acks[-1]["ack"] == "completed"
    assert backend.acks[-1]["code"] == "already_processed"

    supervisor.handle_command(make_command("stop_strategy", suffix="3"))
    assert supervisor.instances[INSTANCE_ID].state is InstanceState.STOPPED
    assert backend.acks[-1]["observed_state"] == InstanceState.STOPPED.value


def test_expired_command_is_rejected(setup):
    supervisor, _bridge, backend, _store = setup
    expired = Command(
        id="55555555-5555-5555-5555-555555555555",
        instance_id=INSTANCE_ID,
        type="start",
        payload={},
        expires_at=(datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(),
        attempt=1,
    )
    supervisor.handle_command(expired)
    assert backend.acks[-1]["ack"] == "rejected"
    assert backend.acks[-1]["code"] == "command_expired"
    assert INSTANCE_ID not in supervisor.instances


def test_profit_target_stops_and_publishes_reason(setup):
    supervisor, bridge, _backend, store = setup
    start_instance(supervisor, bridge)
    instance = supervisor.instances[INSTANCE_ID]
    instance.objective = ObjectiveLimits(
        profit_target_net="10",
        max_loss_net="5",
        reference="session",
        stop_policy="keep_positions",
        max_trades=100,
    )
    instance.session_start_equity = "10000"
    instance.day_start_equity = "10000"
    bridge.set_equity(AccountRef(ACCOUNT_ID, "Sim-Demo", "12345678", "demo"), "10012")

    supervisor.tick_running_instances()

    assert instance.state is InstanceState.STOPPED
    body = store.next_outbox(1)[0].body
    risk_events = [
        event
        for event in body["events"]
        if event["event_type"] == "risk_block" and event.get("result") == "profit_target"
    ]
    assert risk_events
    assert risk_events[0]["detail"]["objective"] is True


def test_max_loss_stops_entries(setup):
    supervisor, bridge, _backend, store = setup
    start_instance(supervisor, bridge)
    instance = supervisor.instances[INSTANCE_ID]
    instance.objective = ObjectiveLimits(
        profit_target_net="10",
        max_loss_net="5",
        reference="session",
        stop_policy="keep_positions",
        max_trades=100,
    )
    instance.session_start_equity = "10000"
    instance.day_start_equity = "10000"
    bridge.set_equity(AccountRef(ACCOUNT_ID, "Sim-Demo", "12345678", "demo"), "9990")

    supervisor.tick_running_instances()

    assert instance.state is InstanceState.STOPPED
    events = [event for entry in store.next_outbox(25) for event in entry.body["events"]]
    assert any(
        event["event_type"] == "risk_block" and event.get("result") == "max_loss"
        for event in events
    )


def test_terminal_loss_marks_disconnected(setup):
    supervisor, bridge, _backend, _store = setup
    start_instance(supervisor, bridge)
    bridge.force_disconnect = True
    supervisor.detect_stalled_instances()
    assert supervisor.instances[INSTANCE_ID].state is InstanceState.DISCONNECTED


def test_real_mode_without_authorization_is_rejected(tmp_path):
    load_builtin_strategies()
    bridge = SimulatorBridge()
    config = EngineConfig(
        backend_url="https://backend.example",
        engine_id="engine-test",
        auth_secret="x" * 32,
    )
    store = EngineStore(str(tmp_path / "state"))
    backend = FakeBackend(runtime(environment="real", real_authorized=False))
    supervisor = Supervisor(config=config, bridge=bridge, backend=backend, store=store)
    supervisor.handle_command(make_command("start"))
    assert backend.acks[-1]["ack"] == "rejected"
    assert backend.acks[-1]["code"] == "preparation_refused"
    store.close()


def test_position_attribution_never_guesses():
    instance = type(
        "Runtime",
        (),
        {"instance_id": INSTANCE_ID, "magic": 740001},
    )()
    own = PositionRecord(
        "1", "XAUUSD", "buy", "0.01", "2400", "2400", "0", "0", 0,
        instance_id=INSTANCE_ID[:8], magic=740001,
    )
    other_magic = PositionRecord(
        "2", "XAUUSD", "buy", "0.01", "2400", "2400", "0", "0", 0,
        instance_id=INSTANCE_ID[:8], magic=740002,
    )
    manual = PositionRecord(
        "3", "XAUUSD", "buy", "0.01", "2400", "2400", "0", "0", 0,
        instance_id=None, magic=0,
    )
    assert _belongs_to_instance(own, instance)
    assert not _belongs_to_instance(other_magic, instance)
    assert not _belongs_to_instance(manual, instance)
