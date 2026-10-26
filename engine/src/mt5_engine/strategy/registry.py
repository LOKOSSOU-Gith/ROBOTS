"""Registre extensible des stratégies (§6).

Ajouter une stratégie = déposer un module et l'enregistrer, sans reconstruire
le site. Le registre refuse une version inconnue ou marquée Martingale.
"""

from __future__ import annotations

import importlib
import pkgutil
from typing import Type

from .base import StrategyBase


class RegistryError(RuntimeError):
    pass


_REGISTRY: dict[tuple[str, str], Type[StrategyBase]] = {}


def register_strategy(cls: Type[StrategyBase]) -> Type[StrategyBase]:
    """Décorateur d'enregistrement ; appelé à l'import du module de stratégie."""
    manifest = getattr(cls, "manifest", None)
    if manifest is None:
        raise RegistryError(f"{cls.__name__}: manifest absent")
    # Garde-fou structurel (§6.1) : le registre refuse une stratégie qui se
    # déclarerait autorisée au Martingale, même enregistrée par erreur.
    if manifest.martingale_allowed:
        raise RegistryError(
            f"{manifest.slug} {manifest.version}: martingale_allowed=True interdit"
        )
    _REGISTRY[(manifest.slug, manifest.version)] = cls
    return cls


def registered() -> list[tuple[str, str]]:
    return sorted(_REGISTRY)


def resolve_strategy(slug: str, version: str) -> Type[StrategyBase]:
    cls = _REGISTRY.get((slug, version))
    if cls is None:
        raise RegistryError(f"stratégie non déployée sur ce moteur: {slug}@{version}")
    return cls


def load_builtin_strategies() -> None:
    """Importe tous les modules du paquet `mt5_engine.strategy` (§6, §15 P4)."""
    package = importlib.import_module("mt5_engine.strategy")
    for module_info in pkgutil.iter_modules(package.__path__):
        if module_info.name.startswith("_"):
            continue
        importlib.import_module(f"mt5_engine.strategy.{module_info.name}")
