"""Robot 1 — Scalping Momentum (§5).

Croisement d'EMA rapide/lente sur les bougies du timeframe configuré. Ce
gabarit n'affirme aucune rentabilité ; il est refusé en mode réel par le
moteur tant qu'il n'a pas été remplacé par une stratégie validée.

Le volume n'est jamais décidé ici : le signal ne porte qu'une direction, un
stop et une fraction plafond. Le moteur calcule le lot (§6.1).
"""

from __future__ import annotations

from .base import Signal, StrategyBase, StrategyContext, StrategyManifest
from .common import closes, ema, has_position_on, trading_window_open
from .registry import register_strategy


@register_strategy
class ScalpMomentumStrategy(StrategyBase):
    manifest = StrategyManifest(
        slug="scalp-momentum",
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
            "min_stop_distance_points": 100,
            "max_lot_risk_pct": 1,
            "requires_stop_loss": True,
            "max_concurrent_positions": 2,
        },
        description="Gabarit de scalping sur croisement d'EMA, non validé.",
        artifact_digest="sha256:scalp-momentum-v1",
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

        fast_period = int(self.parameter("fast_ema", 9))
        slow_period = int(self.parameter("slow_ema", 21))
        stop_points = int(self.parameter("stop_distance_points", 250))
        if fast_period >= slow_period or stop_points <= 0:
            return []

        signals: list[Signal] = []
        for logical in sorted(context.logical_to_broker):
            symbol = context.symbol(logical)
            candles = context.rates.get(
                context.logical_to_broker[logical].upper(), ()
            )
            if symbol is None or len(candles) < slow_period + 2:
                continue
            if has_position_on(
                context.account.open_positions,
                context.logical_to_broker[logical],
                logical,
            ):
                continue

            values = closes(candles)
            fast_now = ema(values, fast_period)
            slow_now = ema(values, slow_period)
            fast_prev = ema(values[:-1], fast_period)
            slow_prev = ema(values[:-1], slow_period)
            if None in (fast_now, slow_now, fast_prev, slow_prev):
                continue

            side = None
            reason = ""
            if fast_prev <= slow_prev and fast_now > slow_now:
                side = "buy"
                reason = "croisement haussier EMA rapide/lente"
            elif fast_prev >= slow_prev and fast_now < slow_now:
                side = "sell"
                reason = "croisement baissier EMA rapide/lente"
            if side is None:
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
