"""T7 — objectifs de gain, perte maximale et quota de trades (§7)."""

import pytest

from mt5_engine.objectives import (
    MAX_LOSS,
    MAX_TRADES,
    PROFIT_TARGET,
    ObjectiveLimits,
    evaluate_objectives,
    session_net,
)


def limits(**overrides) -> ObjectiveLimits:
    base = dict(
        profit_target_net="10",
        max_loss_net="5",
        reference="session",
        stop_policy="keep_positions",
        max_trades=20,
    )
    base.update(overrides)
    return ObjectiveLimits(**base)


def test_net_is_exact_equity_delta():
    assert session_net("10010.25", "10000") == "10.25"
    assert session_net("9995", "10000") == "-5"


def test_profit_target_triggers_at_threshold_not_before():
    assert not evaluate_objectives(limits(), "9.99999999", 0).reached
    result = evaluate_objectives(limits(), "10", 0)
    assert result.triggered == PROFIT_TARGET
    assert "objectif de gain atteint" in result.reason


def test_max_loss_triggers_symmetrically():
    assert not evaluate_objectives(limits(), "-4.99", 0).reached
    result = evaluate_objectives(limits(), "-5", 0)
    assert result.triggered == MAX_LOSS


def test_max_trades_has_priority_and_is_counted():
    result = evaluate_objectives(limits(max_trades=3), "100", 3)
    assert result.triggered == MAX_TRADES


def test_disabled_targets_never_trigger():
    disabled = limits(profit_target_net="0", max_loss_net="0", max_trades=0)
    assert not evaluate_objectives(disabled, "100000", 999).reached
    assert not evaluate_objectives(disabled, "-100000", 999).reached


def test_invalid_reference_is_refused():
    with pytest.raises(ValueError):
        ObjectiveLimits.from_runtime({"reference": "forever"})
    with pytest.raises(ValueError):
        ObjectiveLimits.from_runtime({"stop_policy": "explode"})


def test_runtime_values_are_parsed_without_default_surprise():
    parsed = ObjectiveLimits.from_runtime(
        {
            "profit_target_net": "12.5",
            "max_loss_net": "3",
            "reference": "day",
            "stop_policy": "close_positions",
            "max_trades": 7,
        }
    )
    assert parsed.reference == "day"
    assert parsed.stop_policy == "close_positions"
    assert parsed.max_trades == 7
