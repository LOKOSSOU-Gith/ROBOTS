"""Robot 4 — Stratégie personnalisée (§5).

Gabarit de cassure du plus haut / plus bas des N dernières bougies. C'est ici
que l'utilisateur branche ses propres règles : la classe respecte le contrat
`StrategyBase`, donc le backend et les contrôles de risque n'ont pas à changer.

Gabarit non validé : aucune performance n'est affirmée.
"""

from __future__ import annotations

from .base import Signal, StrategyBase, StrategyContext, StrategyManifest
from .common import closes, has_position_on, trading_window_open
from .registry import register_strategy


@register_strategy
class BreakoutCustomStrategy(StrategyBase):
    manifest = StrategyManifest(
        slug="breakout-custom",
        version="1.0.0",
        parameter_schema=(
            "lot_risk_pct",
            "stop_distance_points",
            "lookback_bars",
            "session_filter",
            "use_trailing_stop",
        ),
        supported_symbols=("XAUUSD", "EURUSD", "GBPUSD", "USDJPY"),
        risk_constraints={
            "min_stop_distance_points": 100,
            "max_lot_risk_pct": 1,
            "requires_stop_loss": True,
            "max_concurrent_positions": 1,
        },
        description="Gabarit de cassure Donchian, emplacement de vos règles.",
        artifact_digest="sha256:breakout-custom-v1",
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

        lookback = int(self.parameter("lookback_bars", 24))
        stop_points = int(self.parameter("stop_distance_points", 400))
        if lookback < 2 or stop_points <= 0:
            return []

        signals: list[Signal] = []
        for logical in sorted(context.logical_to_broker):
            symbol = context.symbol(logical)
            broker_symbol = context.logical_to_broker[logical].upper()
            candles = context.rates.get(broker_symbol, ())
            if symbol is None or len(candles) < lookback + 2:
                continue
            if has_position_on(context.account.open_positions, broker_symbol, logical):
                continue

            previous = candles[-lookback - 1 : -1]
            highs = [float(candle.high) for candle in previous]
            lows = [float(candle.low) for candle in previous]
            last_close = closes(candles)[-1]
            if not highs or not lows:
                continue

            if last_close > max(highs):
                side = "buy"
                reason = f"cassure du plus haut des {lookback} bougies"
            elif last_close < min(lows):
                side = "sell"
                reason = f"cassure du plus bas des {lookback} bougies"
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
