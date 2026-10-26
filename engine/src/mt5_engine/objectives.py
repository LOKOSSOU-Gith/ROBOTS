"""Objectifs de gain et pertes maximales (§7 du prompt maître).

Le résultat net d'une exécution est mesuré sur l'équité réelle :

    net = équité courante - équité au début de la référence

L'équité inclut déjà les commissions, swaps et le profit latent. Aucun chiffre
fourni par la stratégie n'entre dans ce calcul.

Deux références sont possibles :
 - `session` : depuis le démarrage de l'exécution du robot ;
 - `day` : depuis le début de la journée UTC observée.

Le seuil atteint ne promet pas une exécution exacte : le slippage, les gaps et
les pannes peuvent le dépasser. Il déclenche l'arrêt des nouvelles entrées,
pas une garantie de prix.
"""

from __future__ import annotations

from dataclasses import dataclass

from .volume import NumberFormatError, from_scaled, to_scaled

PROFIT_TARGET = "profit_target"
MAX_LOSS = "max_loss"
MAX_TRADES = "max_trades"

VALID_REFERENCES = ("session", "day")
VALID_STOP_POLICIES = ("keep_positions", "close_positions")


@dataclass(frozen=True)
class ObjectiveLimits:
    profit_target_net: str = "0"
    max_loss_net: str = "0"
    reference: str = "session"
    stop_policy: str = "keep_positions"
    max_trades: int = 0

    @classmethod
    def from_runtime(cls, raw: dict | None) -> "ObjectiveLimits":
        objective = raw or {}
        reference = str(objective.get("reference", "session"))
        policy = str(objective.get("stop_policy", "keep_positions"))
        if reference not in VALID_REFERENCES:
            raise ValueError(f"référence d'objectif inconnue: {reference}")
        if policy not in VALID_STOP_POLICIES:
            raise ValueError(f"politique d'arrêt inconnue: {policy}")
        return cls(
            profit_target_net=str(objective.get("profit_target_net", "0")),
            max_loss_net=str(objective.get("max_loss_net", "0")),
            reference=reference,
            stop_policy=policy,
            max_trades=int(objective.get("max_trades", 0)),
        )


@dataclass(frozen=True)
class ObjectiveEvaluation:
    triggered: str | None
    net: str
    reason: str

    @property
    def reached(self) -> bool:
        return self.triggered is not None


def session_net(equity_now: str, equity_start: str) -> str:
    """Résultat net d'une référence, en décimal exact à 1e-8."""
    return from_scaled(to_scaled(equity_now) - to_scaled(equity_start))


def evaluate_objectives(
    limits: ObjectiveLimits, net: str, trades_count: int
) -> ObjectiveEvaluation:
    try:
        value = to_scaled(net)
        target = to_scaled(limits.profit_target_net)
        max_loss = to_scaled(limits.max_loss_net)
    except NumberFormatError as exc:
        raise ValueError("objectif illisible") from exc

    if limits.max_trades > 0 and trades_count >= limits.max_trades:
        return ObjectiveEvaluation(
            MAX_TRADES,
            net,
            f"nombre maximal de trades atteint ({trades_count}/{limits.max_trades})",
        )
    if target > 0 and value >= target:
        return ObjectiveEvaluation(
            PROFIT_TARGET,
            net,
            f"objectif de gain atteint : {net} >= {limits.profit_target_net}",
        )
    if max_loss > 0 and value <= -max_loss:
        return ObjectiveEvaluation(
            MAX_LOSS,
            net,
            f"perte maximale atteinte : {net} <= -{limits.max_loss_net}",
        )
    return ObjectiveEvaluation(None, net, "")
