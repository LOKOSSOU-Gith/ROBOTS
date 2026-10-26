"""Robot 2 — Suivi de tendance (§5).

EMA lente et EMA rapide, avec filtre de pente : une position n'est ouverte que
dans le sens de la tendance confirmée. Gabarit non validé, aucune performance
promise.
"""

from __future__ import annotations

from .base import Signal, StrategyBase, StrategyContext, StrategyManifest
from .common import closes, ema, has_position_on, trading_window_open
from .registry import register_strategy


@register_strategy
class TrendFollowingStrategy(StrategyBase):
    manifest = StrategyManifest(
        slug="trend-following",
        version="1.0.0",
        parameter_schema=(
            "lot_risk_pct",
            "stop_distance_points",
            "fast_ema",
            "slow_ema",
            "session_filter",
            "use_trailing_stop",
        ),
        supported_symbols=("XAUUSD", "EURUSD", "GBPUSD", "USDJPY"),
        risk_constraints={
            "min_stop_distance_points": 300,
            "max_lot_risk_pct": 1,
            "requires_stop_loss": True,
            "max_concurrent_positions": 1,
        },
        description="Gabarit de suivi de tendance EMA50/EMA200, non validé.",
        artifact_digest="sha256:trend-following-v1",
    )

    def on_start(self, context: StrategyContext) -> None:
        if context.mode == "real":
            raise RuntimeError("gabarit non validé pour le mode réel")

    def tick(self, context: StrategyContext) -> list[Signal]:
        if not trading_window_open(
            str(self.parameter("session_filter", "any")),
            context.allowed_hours,
        ):
            return []

        fast_period = int(self.parameter("fast_ema", 50))
        slow_period = int(self.parameter("slow_ema", 200))
        stop_points = int(self.parameter("stop_distance_points", 600))
        if fast_period >= slow_period or stop_points <= 0:
            return []

        signals: list[Signal] = []
        for logical in sorted(context.logical_to_broker):
            symbol = context.symbol(logical)
            broker_symbol = context.logical_to_broker[logical].upper()
            candles = context.rates.get(broker_symbol, ())
            if symbol is None or len(candles) < slow_period + 3:
                continue
            if has_position_on(context.account.open_positions, broker_symbol, logical):
                continue

            values = closes(candles)
            fast = ema(values, fast_period)
            slow = ema(values, slow_period)
            slow_prev = ema(values[:-5], slow_period)
            if fast is None or slow is None or slow_prev is None:
                continue

            slope_up = slow > slow_prev
            slope_down = slow < slow_prev
            if fast > slow and slope_up and values[-1] > fast:
                side = "buy"
                reason = "EMA rapide au-dessus de la lente, pente haussière"
            elif fast < slow and slope_down and values[-1] < fast:
                side = "sell"
                reason = "EMA rapide sous la lente, pente baissière"
            else:
                continue

            signals.append(
                Signal(
                    action="open",
                    logical_symbol=logical,
                    side=side,
                    stop_distance_points=stop_points,
                    reason=reason,
                )
            )
        return signals
