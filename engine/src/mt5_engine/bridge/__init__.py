"""Pont vers le terminal MT5 (§4).

La bibliothèque officielle `MetaTrader5` ne pilote un terminal que dans un
environnement Windows compatible. Le moteur tourne sur le VPS Linux Contabo :
il ne l'importe donc jamais directement. Deux implémentations existent :

 - `simulator.py`        : comportement déterministe, utilisé par P0 et T1-T8 ;
 - `windows_agent_client.py` : client HTTPS vers l'agent Windows qui, lui,
   héberge le terminal et le paquet `MetaTrader5`.

Le point d'entrée unique (`TerminalBridge`) garantit qu'aucune stratégie ne
peut choisir elle-même son exécutant.
"""

from .base import (
    BridgeUnavailable,
    ConnectionResult,
    OrderRequest,
    OrderResult,
    TerminalBridge,
)
from .simulator import SimulatorBridge

__all__ = [
    "BridgeUnavailable",
    "ConnectionResult",
    "OrderRequest",
    "OrderResult",
    "SimulatorBridge",
    "TerminalBridge",
]
