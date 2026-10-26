"""Framework de stratégies (§6).

Une stratégie ne peut rien envoyer seule : elle déclare des intentions, le
moteur les vérifie (risque §7.1, volumes §6.1, bornes du symbole §6) puis
transmet au pont terminal. C'est cette séparation qui rend le Martingale
impossible par construction plutôt que simplement déconseillé.
"""

from .base import (
    Signal,
    StrategyContext,
    StrategyBase,
    StrategyManifest,
    symbol_aliases_for_broker,
)
from .registry import RegistryError, load_builtin_strategies, register_strategy, resolve_strategy

__all__ = [
    "RegistryError",
    "Signal",
    "StrategyBase",
    "StrategyContext",
    "StrategyManifest",
    "load_builtin_strategies",
    "register_strategy",
    "resolve_strategy",
    "symbol_aliases_for_broker",
]
