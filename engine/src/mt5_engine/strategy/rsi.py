"""Robot 3 — RSI (§5).

Entrée en survente/surachat RSI. Le stop reste obligatoire : le moteur refuse
tout ordre sans distance de risque. Gabarit non validé.
"""

from __future__ import annotations

from .base import Signal, StrategyBase, StrategyContext, StrategyManifest
from .common import closes, has_position_on, rsi, trading_window_open
from .registry import register_strategy


@register_strategy
class RsiReversionStrategy(StrategyBase):
    manifest = StrategyManifest(
        slug="rsi-reversion",
        version="1.0.0",
        parameter_schema=(
            "lot_risk_pct",
            "stop_distance_points",
            "rsi_period",
            "rsi_buy",
            "rsi_sell",
            "session_filter",
        ),
        supported_symbols=("XAUUSD", "EURUSD", "GBPUSD", "USDJPY"),
        risk_constraints={
            "min_stop_distance_points": 100,
            "max_lot_risk_pct": 1,
            "requires_stop_loss": True,
            "max_concurrent_positions": 1,
        },
        description="Gabarit de retour à la moyenne RSI(14), non validé.",
        artifact_digest="sha256:rsi-reversion-v1",
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

        period = int(self.parameter("rsi_period", 14))
        buy_level = int(self.parameter("rsi_buy", 30))
        sell_level = int(self.parameter("rsi_sell", 70))
        stop_points = int(self.parameter("stop_distance_points", 300))
        if buy_level >= sell_level or stop_points <= 0:
            return []

        signals: list[Signal] = []
        for logical in sorted(context.logical_to_broker):
            symbol = context.symbol(logical)
            broker_symbol = context.logical_to_broker[logical].upper()
            candles = context.rates.get(broker_symbol, ())
            if symbol is None or len(candles) < period + 2:
                continue
            if has_position_on(context.account.open_positions, broker_symbol, logical):
                continue

            value = rsi(closes(candles), period)
            if value is None:
                continue
            if value <= buy_level:
                side = "buy"
                reason = f"RSI {value:.1f} en survente (<= {buy_level})"
            elif value >= sell_level:
                side = "sell"
                reason = f"RSI {value:.1f} en surachat (>= {sell_level})"
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
