"""Contrat d'une stratégie du catalogue (§6)."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal

from ..bridge.base import Candle
from ..risk import AccountSnapshot, RiskLimits, SymbolSnapshot

Side = Literal["buy", "sell"]


@dataclass(frozen=True)
class StrategyManifest:
    """Identité stable d'une version de stratégie (§6).

    Le couple (slug, version) doit correspondre exactement à la ligne
    `strategy_versions` sinon le moteur refuse de l'exécuter : une instance ne
    peut pas rouler un artefact différent de celui qui a été validé.
    """

    slug: str
    version: str
    parameter_schema: tuple[str, ...]
    supported_symbols: tuple[str, ...]
    risk_constraints: dict = field(default_factory=dict)
    description: str = ""
    # Constante structurelle : aucune stratégie du catalogue ne peut la passer à True.
    martingale_allowed: bool = False
    artifact_digest: str = ""


@dataclass(frozen=True)
class Signal:
    """Intention de la stratégie. Le moteur décide du volume et de l'exécution."""

    action: Literal["open", "close", "hold"]
    logical_symbol: str | None = None
    side: Side | None = None
    stop_distance_points: int | None = None
    position_id: str | None = None
    reason: str = ""
    # Le volume n'est jamais demandé en lots par la stratégie : il est dérivé
    # de l'équité courante et du risque paramétré, sans historique de pertes.
    max_lot_fraction: float = 1.0


@dataclass(frozen=True)
class StrategyContext:
    """Vue limitée remise à la stratégie à chaque tick.

    Elle ne contient ni secret, ni moyen d'envoyer un ordre : la signature du
    `tick()` rend impossible une exécution directe (§6.1).
    """

    instance_id: str
    mode: str
    parameters: dict
    limits: RiskLimits
    account: AccountSnapshot
    symbols: dict[str, SymbolSnapshot]
    logical_to_broker: dict[str, str]
    allowed_hours: dict = field(default_factory=dict)
    rates: dict[str, tuple[Candle, ...]] = field(default_factory=dict)

    def symbol(self, logical: str) -> SymbolSnapshot | None:
        broker_symbol = self.logical_to_broker.get(logical.upper())
        if broker_symbol is None:
            return None
        return self.symbols.get(broker_symbol.upper())


class StrategyBase(ABC):
    manifest: StrategyManifest

    def __init__(self, parameters: dict) -> None:
        self.parameters = parameters

    def on_start(self, context: StrategyContext) -> None:
        """Initialisation ; toute exception place l'instance en ERROR (§7.2)."""

    @abstractmethod
    def tick(self, context: StrategyContext) -> list[Signal]:
        """Retourne des intentions ; aucune exécution n'a lieu ici."""

    def on_stop(self, context: StrategyContext | None) -> None:
        """Nettoyage à l'arrêt standard ou d'urgence."""

    # ------------------------------------------------------------- utilitaires

    def parameter(self, key: str, default=None):
        return self.parameters.get(key, default)


def symbol_aliases_for_broker(
    aliases: dict[str, list[str]], supported: list[str], broker: str
) -> dict[str, str]:
    """Résolution logique -> symbole broker (§6).

    XAUUSD et XAUUSDm ne sont jamais supposés interchangeables : sans alias
    explicite pour ce broker, le symbole logique n'est pas mappé et le moteur
    refuse de négocier dessus.
    """
    broker_key = broker.strip().lower().replace(" ", "_")
    broker_suffixes = [alias.strip().upper() for alias in (aliases.get(broker_key) or [])]
    mapping: dict[str, str] = {}
    for logical in supported:
        upper = logical.strip().upper()
        mapping[upper] = upper
    for index, suffix in enumerate(broker_suffixes):
        if index >= len(supported):
            break
        logical = supported[index].strip().upper()
        mapping[logical] = suffix
    return mapping
