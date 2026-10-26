"""T1 — unitaires : volumes, arrondis, symboles, paramètres (§13).

Critère : résultats déterministes, valeurs hors limites rejetées.
"""

import pytest

from mt5_engine.anti_martingale import Position, total_exposure
from mt5_engine.parameters import validate_parameters
from mt5_engine.states import (
    ALLOWED_TRANSITIONS,
    InstanceState,
    parse_state,
    transition_allowed,
)
from mt5_engine.strategy.base import symbol_aliases_for_broker
from mt5_engine.volume import (
    LotConstraints,
    VolumeInputs,
    compute_base_volume,
    floor_to_step,
    from_scaled,
    resolve_lot,
    to_scaled,
)

LOT = LotConstraints("0.01", "10", "0.01")


def test_to_scaled_and_back_are_exact():
    # La représentation canonique retire les zéros de fin ; c'est la valeur
    # numérique qui doit être exacte, pas le nombre de décimales affichées.
    for value in ["0.01", "1", "10", "0.12345678", "2400.30", "1.0851"]:
        assert to_scaled(from_scaled(to_scaled(value))) == to_scaled(value)


def test_resolution_is_deterministic():
    assert from_scaled(to_scaled("0.1")) == from_scaled(to_scaled("0.10000000"))


def test_floor_to_step_never_exceeds_limit():
    assert floor_to_step(to_scaled("0.017"), to_scaled("0.01")) == to_scaled("0.01")
    assert floor_to_step(to_scaled("0.02"), to_scaled("0.01")) == to_scaled("0.02")


def test_resolve_lot_clamps_to_max_downward():
    resolution = resolve_lot("0.017", LOT)
    assert resolution.volume == "0.01"
    assert resolution.rejected_reason == "none"


def test_resolve_lot_rejects_below_min_and_non_positive():
    assert resolve_lot("0.001", LOT).volume is None
    assert resolve_lot("0", LOT).rejected_reason == "non_positive"
    assert resolve_lot("-1", LOT).volume is None


def test_compute_base_volume_documented_formula():
    # equity 10000 x 0.25 % = 25 ; 25 / (300 pts x 1 par lot) = 0.0833 -> 0.08
    resolution = compute_base_volume(
        VolumeInputs(
            equity="10000",
            risk_per_trade_pct="0.25",
            stop_distance_points=300,
            point_value_per_lot="1",
            lot=LOT,
        )
    )
    assert resolution.volume == "0.08"
    assert resolution.clamped_to_max is False


def test_compute_base_volume_rejects_invalid_inputs():
    base = dict(
        equity="10000",
        risk_per_trade_pct="0.25",
        stop_distance_points=300,
        point_value_per_lot="1",
        lot=LOT,
    )
    assert compute_base_volume(VolumeInputs(**{**base, "stop_distance_points": 0})).volume is None
    assert compute_base_volume(VolumeInputs(**{**base, "equity": "0"})).volume is None
    assert (
        compute_base_volume(VolumeInputs(**{**base, "risk_per_trade_pct": "150"})).volume is None
    )
    assert compute_base_volume(VolumeInputs(**{**base, "point_value_per_lot": "0"})).volume is None


def test_larger_stop_distance_never_larger_lot():
    small_stop = compute_base_volume(
        VolumeInputs("10000", "0.25", 100, "1", LOT)
    )
    large_stop = compute_base_volume(
        VolumeInputs("10000", "0.25", 1000, "1", LOT)
    )
    assert to_scaled(small_stop.volume) > to_scaled(large_stop.volume)


# ------------------------------------------------------------------ symboles §6

SUPPORTED = ["XAUUSD", "EURUSD"]


def test_broker_suffix_is_not_assumed_interchangeable():
    mapping = symbol_aliases_for_broker({"peaks": ["XAUUSDm", "EURUSDm"]}, SUPPORTED, "Peaks")
    # Les symboles broker sont normalisés en majuscules avant comparaison.
    assert mapping["XAUUSD"] == "XAUUSDM"
    assert mapping["EURUSD"] == "EURUSDM"


def test_unknown_broker_keeps_logical_symbol_only():
    mapping = symbol_aliases_for_broker({"other_broker": ["XAUUSDr"]}, SUPPORTED, "Peaks")
    assert mapping["XAUUSD"] == "XAUUSD"


# ---------------------------------------------------------------- paramètres §6

SCHEMA = {
    "lot_risk_pct": {"type": "number", "default": 0.25, "min": 0.01, "max": 1},
    "stop_distance_points": {"type": "integer", "default": 300, "min": 50, "max": 2000},
    "session_filter": {
        "type": "enum",
        "options": ["asian", "london", "new_york", "any"],
        "default": "london",
    },
    "use_trailing_stop": {"type": "boolean", "default": False},
}


def test_parameters_defaults_are_applied():
    result = validate_parameters(SCHEMA, {})
    assert result.ok
    assert result.values["lot_risk_pct"] == 0.25


@pytest.mark.parametrize(
    "incoming,code",
    [
        ({"lot_risk_pct": 5}, "out_of_range"),
        ({"lot_risk_pct": "0.5"}, "wrong_type"),
        ({"stop_distance_points": 10}, "out_of_range"),
        ({"session_filter": "mars"}, "not_in_options"),
        ({"use_trailing_stop": "yes"}, "wrong_type"),
        ({"martingale_multiplier": 2}, "unknown_key"),
    ],
)
def test_parameters_out_of_range_are_rejected(incoming, code):
    result = validate_parameters(SCHEMA, incoming)
    assert not result.ok
    assert code in {issue.code for issue in result.issues}


def test_boolean_is_not_accepted_as_number():
    assert not validate_parameters(SCHEMA, {"lot_risk_pct": True}).ok


# -------------------------------------------------------------------- états §7.2

def test_every_state_has_declared_transitions():
    for state in InstanceState:
        assert state in ALLOWED_TRANSITIONS
        for target in ALLOWED_TRANSITIONS[state]:
            assert isinstance(target, InstanceState)


def test_stopped_cannot_jump_to_running():
    assert not transition_allowed(InstanceState.STOPPED, InstanceState.RUNNING)
    assert transition_allowed(InstanceState.STOPPED, InstanceState.STARTING)


def test_running_can_halt_on_risk():
    assert transition_allowed(InstanceState.RUNNING, InstanceState.RISK_HALTED)
    assert transition_allowed(InstanceState.RUNNING, InstanceState.DISCONNECTED)
    assert not transition_allowed(InstanceState.STOPPED, InstanceState.RISK_HALTED)


def test_parse_state_rejects_unknown():
    with pytest.raises(ValueError):
        parse_state("PAUSED")


# ------------------------------------------------------------------- exposition §6

def test_total_exposure_is_sum_of_notionals():
    positions = [Position("0.10", "2400", 100), Position("0.10", "2400", 100)]
    # 0.10 lot x 2400 x contrat 100 = 24 000 par position, soit 48 000.
    assert total_exposure(positions) == "48000"
