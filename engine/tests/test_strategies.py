"""T1/T2 — les quatre gabarits de stratégie et l'absence de Martingale."""

from __future__ import annotations

import pytest

from mt5_engine.anti_martingale import Position
from mt5_engine.bridge.base import Candle
from mt5_engine.risk import AccountSnapshot, RiskLimits, SymbolSnapshot
from mt5_engine.strategy.base import StrategyContext
from mt5_engine.strategy.breakout import BreakoutCustomStrategy
from mt5_engine.strategy.common import hour_allowed, rsi, session_contains
from mt5_engine.strategy.registry import load_builtin_strategies, registered
from mt5_engine.strategy.rsi import RsiReversionStrategy
from mt5_engine.strategy.scalp import ScalpMomentumStrategy
from mt5_engine.strategy.trend import TrendFollowingStrategy


def candle(close: float, high: float | None = None, low: float | None = None) -> Candle:
    return Candle(
        time_ms=0,
        open=f"{close:.5f}",
        high=f"{high if high is not None else close + 0.5:.5f}",
        low=f"{low if low is not None else close - 0.5:.5f}",
        close=f"{close:.5f}",
        volume="100",
    )


def context(candles: list[Candle], **parameter_overrides) -> StrategyContext:
    symbol = SymbolSnapshot(
        symbol="XAUUSD",
        spread_points=10,
        min_lot="0.01",
        max_lot="10",
        lot_step="0.01",
        point_value_per_lot="1",
        digits=2,
        contract_size=100,
        trading_enabled=True,
    )
    return StrategyContext(
        instance_id="00000000-0000-0000-0000-000000000001",
        mode="demo",
        parameters=parameter_overrides,
        limits=RiskLimits(
            max_daily_loss="20",
            max_drawdown_pct="10",
            max_open_positions=2,
            max_total_exposure="20000",
            max_spread_points=50,
            min_margin_level_pct="200",
            max_risk_per_trade_pct="0.5",
            max_lot_size="0.10",
        ),
        account=AccountSnapshot(
            equity="10000",
            balance="10000",
            margin_level_pct="0",
            daily_realized_pnl="0",
            peak_equity="10000",
            open_positions=(),
        ),
        symbols={"XAUUSD": symbol},
        logical_to_broker={"XAUUSD": "XAUUSD"},
        allowed_hours={"start": 0, "end": 24},
        rates={"XAUUSD": tuple(candles)},
    )


def test_four_robots_are_registered():
    load_builtin_strategies()
    slugs = {slug for slug, _version in registered()}
    assert {
        "scalp-momentum",
        "trend-following",
        "rsi-reversion",
        "breakout-custom",
    } <= slugs


def test_no_strategy_parameter_can_multiply_volume():
    load_builtin_strategies()
    for slug, version in registered():
        from mt5_engine.strategy.registry import resolve_strategy

        manifest = resolve_strategy(slug, version).manifest
        assert manifest.martingale_allowed is False
        joined = " ".join(manifest.parameter_schema).lower()
        assert "martingale" not in joined
        assert "multiplier" not in joined
        assert "recovery" not in joined


def test_scalping_opens_on_ema_cross_with_stop():
    strategy = ScalpMomentumStrategy({"fast_ema": 3, "slow_ema": 5, "stop_distance_points": 250})
    # Tendance descendante puis retournement : l'EMA rapide repasse au-dessus.
    candles = [candle(value) for value in [10, 9, 8, 7, 6, 5, 4, 4.2, 5.5, 7.0]]
    signals = strategy.tick(context(candles))
    assert len(signals) == 1
    assert signals[0].action == "open"
    assert signals[0].side == "buy"
    assert signals[0].stop_distance_points == 250


def test_trend_following_requires_long_history_and_stays_flat_without_it():
    strategy = TrendFollowingStrategy({"fast_ema": 20, "slow_ema": 100})
    candles = [candle(value) for value in range(1, 50)]
    assert strategy.tick(context(candles)) == []

    rising = [candle(100 + index * 0.5) for index in range(160)]
    signals = strategy.tick(context(rising))
    assert len(signals) == 1
    assert signals[0].side == "buy"


def test_rsi_opens_buy_in_oversold():
    strategy = RsiReversionStrategy({"rsi_period": 14, "rsi_buy": 30, "rsi_sell": 70})
    falling = [candle(100 - index) for index in range(20)]
    assert rsi([100 - index for index in range(20)], 14) < 30
    signals = strategy.tick(context(falling))
    assert len(signals) == 1
    assert signals[0].side == "buy"


def test_breakout_opens_above_previous_highs():
    strategy = BreakoutCustomStrategy({"lookback_bars": 3, "stop_distance_points": 400})
    candles = [
        candle(10, high=10.5, low=9.5),
        candle(11, high=11.5, low=10.5),
        candle(12, high=12.5, low=11.5),
        candle(13, high=13.5, low=12.5),
        candle(20, high=20.5, low=13.0),
    ]
    signals = strategy.tick(context(candles))
    assert len(signals) == 1
    assert signals[0].side == "buy"


def test_strategies_never_trade_outside_the_configured_hours():
    strategy = ScalpMomentumStrategy({"fast_ema": 3, "slow_ema": 5})
    ctx = context([candle(value) for value in [10, 9, 8, 7, 6, 5, 4, 4.2, 5.5, 7.0]])
    closed = StrategyContext(
        instance_id=ctx.instance_id,
        mode=ctx.mode,
        parameters=ctx.parameters,
        limits=ctx.limits,
        account=ctx.account,
        symbols=ctx.symbols,
        logical_to_broker=ctx.logical_to_broker,
        allowed_hours={"start": 0, "end": 0},
        rates=ctx.rates,
    )
    assert strategy.tick(closed) == []


def test_strategies_refuse_real_mode():
    strategy = ScalpMomentumStrategy({})
    ctx = context([candle(1)])
    real = StrategyContext(
        instance_id=ctx.instance_id,
        mode="real",
        parameters=ctx.parameters,
        limits=ctx.limits,
        account=ctx.account,
        symbols=ctx.symbols,
        logical_to_broker=ctx.logical_to_broker,
        allowed_hours=ctx.allowed_hours,
        rates=ctx.rates,
    )
    with pytest.raises(RuntimeError):
        strategy.on_start(real)


def test_session_and_hours_helpers_close_by_default():
    assert session_contains("london", 8)
    assert not session_contains("london", 20)
    assert hour_allowed({"start": 8, "end": 17}, 9)
    assert not hour_allowed({"start": 8, "end": 17}, 7)
    assert not hour_allowed({}, 12)
    assert not hour_allowed({"start": 10, "end": 10}, 12)
