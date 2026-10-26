"""Point d'entrée du service moteur : `python -m mt5_engine` (§12.3).

Le moteur tourne comme service supervisé sur le VPS Contabo, avec redémarrage
contrôlé et logs structurés. Il n'expose aucun port : tout le trafic est
sortant (§8.1, §12.3).
"""

from __future__ import annotations

import sys

from .config import ConfigError, EngineConfig
from .logs import get_logger, log_fields
from .store import EngineStore
from .supervisor import Supervisor, build_bridge
from .backend_client import BackendClient
from .strategy.registry import load_builtin_strategies

log = get_logger("mt5_engine.main")


def main(argv: list[str] | None = None) -> int:
    if argv and "--check" in argv:
        return self_check()

    try:
        config = EngineConfig.from_env()
    except ConfigError as exc:
        # Le message nomme la variable, jamais sa valeur (§9.1).
        log_fields("error", "configuration refusée", {"reason": str(exc)})
        return 2

    load_builtin_strategies()
    store = EngineStore(config.state_dir)
    bridge = build_bridge(config)
    backend = BackendClient(config)
    supervisor = Supervisor(config, bridge, backend, store)

    try:
        supervisor.run_forever()
    except KeyboardInterrupt:
        supervisor.shutdown()
        return 130
    return 0


def self_check() -> int:
    """P0 — vérification de compatibilité avant tout engagement de capacité (§16).

    Réponses attendues :
      - Linux + windows_bridge : correct si l'agent MT5 est joignable ;
      - Linux + MetaTrader5 importable : impossible, ne pas le tenter ;
      - Windows + MetaTrader5 : le pont agent local est applicable.
    """
    import platform

    try:
        config = EngineConfig.from_env()
    except ConfigError as exc:
        print(f"config: {exc}")
        return 2

    os_name = platform.system()
    print(f"OS detecte: {os_name}")
    print(f"executable: {sys.executable}")
    print(f"mode terminal configure: {config.terminal_kind}")

    try:
        import MetaTrader5  # noqa: F401
        package_available = True
    except ImportError:
        package_available = False

    if os_name != "Windows":
        print(
            "paquet MetaTrader5 utilisable nativement: non (OS non Windows) — "
            "le pont agent est obligatoire, le paquet n'est pas tente ici"
        )
    elif package_available:
        print("paquet MetaTrader5 utilisable nativement: oui")
    else:
        print("paquet MetaTrader5 absent: installer l'extra [windows]")

    if config.terminal_kind == "windows_bridge":
        bridge = build_bridge(config)
        reachable = False
        try:
            reachable = bridge.ping()
        except Exception as exc:
            print(f"pont agent injoignable: {type(exc).__name__}")
        print(f"pont agent joignable: {reachable}")
        if os_name != "Windows" and not reachable:
            print("P0 NON SATISFAIT: aucun exécutant MT5 disponible")
            return 3
    else:
        print("executant: simulateur (validation fonctionnelle, jamais du reel)")

    print("P0: structure du moteur verifiee")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
