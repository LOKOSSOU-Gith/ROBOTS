"""Arithmétique des volumes, miroir exact de `src/server/domain/volume.ts`.

Entiers à l'échelle 1e8 : aucun arrondi binaire flottant ne peut produire un
lot légèrement supérieur à la limite. Les résultats sont déterministes (§13 T1)
et identiques entre le backend et le moteur, ce qui est vérifié par test.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

SCALE = 10**8

_NUMBER_RE = re.compile(r"^-?\d+(\.\d+)?$")

# Motifs de rejet, identiques aux chaînes TypeScript pour que les logs se
# correspondent entre les deux processus.
REASON_NONE = "none"
REASON_BELOW_MIN = "below_min"
REASON_NON_POSITIVE = "non_positive"
REASON_RISK_CEILING = "risk_ceiling"


class NumberFormatError(ValueError):
    pass


def to_scaled(value: str | int) -> int:
    if isinstance(value, bool):
        raise NumberFormatError("valeur booléenne refusée")
    raw = str(value).strip() if not isinstance(value, str) else value.strip()
    if not _NUMBER_RE.match(raw):
        raise NumberFormatError(f"valeur numérique invalide: {raw}")
    negative = raw.startswith("-")
    unsigned = raw[1:] if negative else raw
    whole, _, frac = unsigned.partition(".")
    padded = (frac + "00000000")[:8]
    scaled = int(whole or "0") * SCALE + int(padded)
    return -scaled if negative else scaled


def from_scaled(scaled: int) -> str:
    negative = scaled < 0
    absolute = -scaled if negative else scaled
    whole, frac = divmod(absolute, SCALE)
    text = str(frac).rjust(8, "0").rstrip("0")
    result = f"{whole}.{text}" if text else f"{whole}"
    return f"-{result}" if negative else result


def floor_to_step(scaled: int, step_scaled: int) -> int:
    if step_scaled <= 0:
        raise ValueError("pas de lot invalide")
    # division entière vers zéro pour un positif = plancher pour un positif
    return (scaled // step_scaled) * step_scaled


@dataclass(frozen=True)
class LotConstraints:
    min_lot: str
    max_lot: str
    lot_step: str


@dataclass(frozen=True)
class LotResolution:
    volume: str | None
    clamped_to_max: bool
    rejected_reason: str

    @property
    def allowed(self) -> bool:
        return self.volume is not None


def resolve_lot(requested: str, constraints: LotConstraints) -> LotResolution:
    """Normalise un volume dans les bornes du symbole ; SATURE vers le bas au plafond."""
    minimum = to_scaled(constraints.min_lot)
    maximum = to_scaled(constraints.max_lot)
    step = to_scaled(constraints.lot_step)

    value = to_scaled(requested)
    if value <= 0:
        return LotResolution(None, False, REASON_NON_POSITIVE)

    value = floor_to_step(value, step)
    if value < minimum:
        return LotResolution(None, False, REASON_BELOW_MIN)

    clamped = value > maximum
    if clamped:
        value = floor_to_step(maximum, step)
    if value < minimum:
        return LotResolution(None, clamped, REASON_BELOW_MIN)

    return LotResolution(from_scaled(value), clamped, REASON_NONE)


@dataclass(frozen=True)
class VolumeInputs:
    """Équité courante, risque par trade, distance de stop, valeur du point.

    Aucun champ d'historique de pertes : le Martingale est exclu par la
    signature de la fonction (§6.1).
    """

    equity: str
    risk_per_trade_pct: str
    stop_distance_points: int
    point_value_per_lot: str
    lot: LotConstraints


def compute_base_volume(inputs: VolumeInputs) -> LotResolution:
    if inputs.stop_distance_points <= 0:
        return LotResolution(None, False, REASON_RISK_CEILING)

    equity = to_scaled(inputs.equity)
    if equity <= 0:
        return LotResolution(None, False, REASON_NON_POSITIVE)

    risk_pct = to_scaled(inputs.risk_per_trade_pct)
    if risk_pct < 0 or risk_pct > to_scaled("100"):
        return LotResolution(None, False, REASON_RISK_CEILING)

    cash_risk = (equity * risk_pct) // to_scaled("100")
    point_value = to_scaled(inputs.point_value_per_lot)
    if point_value <= 0:
        return LotResolution(None, False, REASON_RISK_CEILING)

    denominator = point_value * inputs.stop_distance_points
    if denominator == 0:
        return LotResolution(None, False, REASON_RISK_CEILING)

    raw_volume = (cash_risk * SCALE) // denominator
    return resolve_lot(from_scaled(raw_volume), inputs.lot)
