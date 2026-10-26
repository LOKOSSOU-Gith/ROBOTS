"""Squelette de stratégie livré en P4 (§6, §13 T1/T2/T5).

Ce gabarit n'a aucune règle d'entrée prétendument profitable : il ouvre une
position par symbole, à la première unité de temps de la fenêtre de session
choisie, puis se contente de surveiller. Il sert à prouver le câblage —
paramètres validés, volume dérivé de l'équité, stop obligatoire, risque
appliqué, événements publiés — et de modèle pour les stratégies futures.

Aucun champ de ce module n'accepte un multiplicateur de lot : la hausse de
l'exposition après perte n'est pas représentable (§6.1).
"""

from __future__ import annotations

from .base import Signal, StrategyBase, StrategyContext, StrategyManifest
from .registry import register_strategy

# Fenêtres de session en heures UTC ; le filtre est explicite, jamais deviné.
_SESSIONS: dict[str, tuple[int, int]] = {
    "asian": (0, 8),
    "london": (7, 16),
    "new_york": (13, 21),
    "any": (0, 24),
}


def session_contains(session_filter: str, hour_utc: int) -> bool:
    window = _SESSIONS.get(session_filter)
    if window is None:
        return False
    start, end = window
    return start <= hour_utc < end


@register_strategy
class SkeletonStrategy(StrategyBase):
    manifest = StrategyManifest(
        slug="skeleton-example",
        version="1.0.0",
        parameter_schema=(
            "lot_risk_pct",
            "stop_distance_points",
            "max_open_positions",
            "session_filter",
            "use_trailing_stop",
        ),
        supported_symbols=("XAUUSD", "EURUSD", "USDCJPY", "WTICOUSD"),
        risk_constraints={
            "min_stop_distance_points": 50,
            "max_lot_risk_pct": 1,
            "requires_stop_loss": True,
            "max_concurrent_positions": 5,
        },
        description="Gabarit d'intégration multi-stratégies, sans règle d'entrée profitable.",
        artifact_digest="sha256:skeleton-v1-placeholder",
    )

    def __init__(self, parameters: dict) -> None:
        super().__init__(parameters)
        # Memoriel de cycle : évite une entrée répétée sur un symbole déjà suivi.
        self._opened_symbols: set[str] = set()

    def on_start(self, context: StrategyContext) -> None:
        self._opened_symbols = set()
        if context.mode == "real":
            # Le réel exige une stratégie validée ; le gabarit ne l'est jamais (§16).
            raise RuntimeError("squelette non autorisé en mode réel")

    def tick(self, context: StrategyContext) -> list[Signal]:
        stop_distance = int(self.parameter("stop_distance_points", 300))
        if stop_distance < self.manifest.risk_constraints["min_stop_distance_points"]:
            return []
        if not self._session_is_open(context):
            return []

        position_count = len(context.account.open_positions)
        ceiling = min(
            int(self.parameter("max_open_positions", 1)),
            int(context.limits.max_open_positions),
        )
        if position_count >= ceiling:
            return []

        signals: list[Signal] = []
        for logical in sorted(context.logical_to_broker):
            if logical in self._opened_symbols:
                continue
            broker_symbol = context.logical_to_broker[logical]
            if any(p.symbol in (broker_symbol, logical) for p in context.account.open_positions):
                continue
            if context.symbol(logical) is None:
                # Symbole non résoluble pour ce broker : on ne négocie pas à l'aveugle (§6).
                continue
            self._opened_symbols.add(logical)
            signals.append(
                Signal(
                    action="open",
                    logical_symbol=logical,
                    side="buy",
                    stop_distance_points=stop_distance,
                    reason="squelette: première entrée de la fenêtre de session",
                )
            )
            break
        return signals

    def on_stop(self, context: StrategyContext | None) -> None:
        self._opened_symbols = set()

    # ------------------------------------------------------------------ interne

    def _session_is_open(self, context: StrategyContext) -> bool:
        from datetime import datetime, timezone

        hour = datetime.now(timezone.utc).hour
        return session_contains(str(self.parameter("session_filter", "london")), hour)
