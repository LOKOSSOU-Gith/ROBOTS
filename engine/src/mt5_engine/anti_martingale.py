"""Garde-fou anti-Martingale appliqué à chaque ordre dans le moteur (§6.1, §7.1).

Le contrôle est double :
 - structurel : le calcul de volume ne reçoit pas l'historique des pertes ;
 - dynamique : toute hausse de lot postérieure à une perte est refusée et
   l'instance est placée en RISK_HALTED par le superviseur.
"""

from __future__ import annotations

from dataclasses import dataclass

from .volume import LotConstraints, SCALE, from_scaled, resolve_lot, to_scaled


@dataclass(frozen=True)
class VolumeDecision:
    volume: str
    reason: str | None
    allowed: bool

    @staticmethod
    def deny(reason: str) -> "VolumeDecision":
        return VolumeDecision("0", reason, False)


@dataclass(frozen=True)
class AntiMartingaleInput:
    requested_volume: str
    baseline_volume: str
    previous_loss_occurred: bool
    duplicate_of_open_position: bool
    lot: LotConstraints
    max_lot_per_trade: str


def assert_no_martingale(inp: AntiMartingaleInput) -> VolumeDecision:
    requested = to_scaled(inp.requested_volume)
    baseline = to_scaled(inp.baseline_volume)
    ceiling = to_scaled(inp.max_lot_per_trade)

    # 1. Une perte antérieure ne doit jamais autoriser un volume supérieur.
    if inp.previous_loss_occurred and requested > baseline:
        return VolumeDecision.deny(
            "hausse de lot après perte refusée "
            f"(demandé {inp.requested_volume} > référence {inp.baseline_volume})"
        )

    # 2. Aucun volume ne dépasse la référence calculée sur l'équité courante.
    if requested > baseline:
        return VolumeDecision.deny(
            f"volume supérieur à la référence de risque ({inp.baseline_volume})"
        )

    # 3. Le plafond par opération du profil de risque s'applique toujours.
    if requested > ceiling:
        return VolumeDecision.deny(
            f"volume supérieur au plafond par opération ({inp.max_lot_per_trade})"
        )

    # 4. Contrôle des ordres répétés (§7.1).
    if inp.duplicate_of_open_position:
        return VolumeDecision.deny("ordre répété sur une position déjà ouverte")

    resolved = resolve_lot(inp.requested_volume, inp.lot)
    if resolved.volume is None:
        return VolumeDecision.deny(
            f"volume non conforme aux bornes du symbole ({resolved.rejected_reason})"
        )

    return VolumeDecision(resolved.volume, None, True)


@dataclass(frozen=True)
class Position:
    """Position ouverte, vue par les contrôles de risque.

    Les champs d'identification sont optionnels : l'exposition ne dépend que du
    volume, du prix et de la taille de contrat.
    """

    volume: str
    open_price: str
    contract_size: int
    symbol: str = ""
    side: str = "buy"
    position_id: str = ""


def total_exposure(positions: list[Position]) -> str:
    """Notionnel cumulé, en échelle 1e8, pour l'exposition totale multi-symboles (§6)."""
    total = 0
    for position in positions:
        volume = to_scaled(position.volume)
        price = to_scaled(position.open_price)
        contract = max(1, int(position.contract_size))
        total += (volume * price * contract) // SCALE
    return from_scaled(total)
