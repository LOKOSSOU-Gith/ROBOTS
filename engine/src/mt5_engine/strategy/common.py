"""Indicateurs et filtres communs aux quatre gabarits de stratégie.

Aucun de ces calculs n'est présenté comme une stratégie rentable. Ils servent
de base déterministe et testable aux quatre robots fournis ; l'utilisateur
remplace les règles par les siennes sans toucher au backend (§6).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from ..bridge.base import Candle

SESSIONS: dict[str, tuple[int, int]] = {
    "asian": (0, 8),
    "london": (7, 16),
    "new_york": (13, 21),
    "any": (0, 24),
}

TIMEFRAMES = {"M1", "M5", "M15", "M30", "H1", "H4", "D1"}


def session_contains(session_filter: str, hour_utc: int) -> bool:
    window = SESSIONS.get(session_filter)
    if window is None:
        return False
    start, end = window
    return start <= hour_utc < end


def hour_allowed(hours: dict | None, hour_utc: int) -> bool:
    """Plage horaire configurée par l'utilisateur (0-24, UTC).

    Une plage absente ou invalide ferme le trading plutôt que de l'ouvrir par
    défaut : le moteur ne devine jamais une autorisation.
    """
    if not hours:
        return False
    try:
        start = int(hours.get("start", 0))
        end = int(hours.get("end", 0))
    except (TypeError, ValueError):
        return False
    return 0 <= start < end <= 24 and start <= hour_utc < end


def trading_window_open(
    session_filter: str, hours: dict | None, now: datetime | None = None
) -> bool:
    hour = (now or datetime.now(timezone.utc)).hour
    return session_contains(session_filter, hour) and hour_allowed(hours, hour)


def closes(candles: Sequence[Candle]) -> list[float]:
    return [float(candle.close) for candle in candles]


def ema(values: Sequence[float], period: int) -> float | None:
    """EMA déterministe ; None si l'historique est insuffisant."""
    if period <= 0 or len(values) < period:
        return None
    multiplier = 2.0 / (period + 1.0)
    current = sum(values[:period]) / period
    for value in values[period:]:
        current = (value - current) * multiplier + current
    return current


def sma(values: Sequence[float], period: int) -> float | None:
    if period <= 0 or len(values) < period:
        return None
    return sum(values[-period:]) / period


def rsi(values: Sequence[float], period: int) -> float | None:
    """RSI de Wilder, calcul stable et sans repaint."""
    if period <= 0 or len(values) <= period:
        return None
    gains = 0.0
    losses = 0.0
    for index in range(1, period + 1):
        delta = values[index] - values[index - 1]
        if delta >= 0:
            gains += delta
        else:
            losses -= delta
    average_gain = gains / period
    average_loss = losses / period
    for index in range(period + 1, len(values)):
        delta = values[index] - values[index - 1]
        gain = max(delta, 0.0)
        loss = max(-delta, 0.0)
        average_gain = (average_gain * (period - 1) + gain) / period
        average_loss = (average_loss * (period - 1) + loss) / period
    if average_loss == 0:
        return 100.0
    relative_strength = average_gain / average_loss
    return 100.0 - (100.0 / (1.0 + relative_strength))


def candle_range_points(candle: Candle, point: float) -> int:
    if point <= 0:
        return 0
    return int(round((float(candle.high) - float(candle.low)) / point))


def has_position_on(
    positions: Sequence, symbol: str, logical: str
) -> bool:
    """Interdit un second ordre sur le même symbole pour cette instance."""
    for position in positions:
        if position.symbol.upper() in {symbol.upper(), logical.upper()}:
            return True
    return False
