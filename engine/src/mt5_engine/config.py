"""Configuration du moteur (§12.5).

Les valeurs proviennent de l'environnement ou d'un fichier .env lu hors du
dépôt. Aucune valeur sensible n'est journalisée, même en cas d'erreur (§9.1).
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field

# Clés dont la valeur ne doit jamais apparaître dans un log, une exception ou
# une réponse (§10). La comparaison se fait sur le nom normalisé.
SECRET_NAME_MARKERS = ("password", "secret", "token", "authorization", "key", "cookie")


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:  # une valeur non numérique est une erreur de déploiement
        raise ConfigError(f"{name}: entier attendu") from exc


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


class ConfigError(RuntimeError):
    """Erreur de configuration ; le message ne contient jamais la valeur fautive."""


@dataclass(frozen=True)
class EngineConfig:
    backend_url: str
    engine_id: str
    auth_secret: str = field(repr=False)

    # windows_bridge | mt5_gateway | simulator (§4).
    terminal_kind: str = "simulator"
    # Agent Windows : URL du service de pont, uniquement en https ou loopback.
    bridge_url: str = ""
    bridge_token: str = field(default="", repr=False)
    # mt5-gateway : API key pour l'authentification
    gateway_api_key: str = field(default="", repr=False)

    heartbeat_interval_seconds: int = 15
    poll_interval_seconds: int = 2
    scan_interval_seconds: int = 5
    command_ttl_seconds: int = 120
    # Tolérance de fraîcheur : une commande passée n'est jamais exécutée (§8.1).
    command_max_age_seconds: int = 110
    disconnect_after_seconds: int = 60

    # File locale persistante : résiste aux coupures réseau (§8.1).
    state_dir: str = "./engine-state"

    request_timeout_seconds: float = 10.0
    log_level: str = "INFO"

    @classmethod
    def from_env(cls) -> "EngineConfig":
        backend_url = os.environ.get("BACKEND_URL", "").strip().rstrip("/")
        engine_id = os.environ.get("ENGINE_SERVICE_ID", "").strip()
        auth_secret = os.environ.get("ENGINE_AUTH_SECRET", "")

        missing = []
        if not backend_url:
            missing.append("BACKEND_URL")
        if not engine_id:
            missing.append("ENGINE_SERVICE_ID")
        if not auth_secret or len(auth_secret) < 16:
            missing.append("ENGINE_AUTH_SECRET")
        if missing:
            raise ConfigError("variables manquantes: " + ", ".join(missing))

        if not backend_url.startswith("https://"):
            # Le canal backend-moteur est authentifié et chiffré (§8.1, §12.3).
            raise ConfigError("BACKEND_URL doit être en https://")

        terminal_kind = os.environ.get("TERMINAL_KIND", "simulator").strip().lower()
        if terminal_kind not in {"simulator", "windows_bridge", "mt5_gateway"}:
            raise ConfigError("TERMINAL_KIND: simulator, windows_bridge ou mt5_gateway")

        bridge_url = os.environ.get("MT5_BRIDGE_URL", "").strip().rstrip("/")
        bridge_token = os.environ.get("MT5_BRIDGE_TOKEN", "")
        gateway_api_key = os.environ.get("MT5_GATEWAY_API_KEY", "")

        if terminal_kind == "windows_bridge":
            if not bridge_url:
                raise ConfigError("MT5_BRIDGE_URL requis avec TERMINAL_KIND=windows_bridge")
            ok = bridge_url.startswith("https://") or bridge_url.startswith(
                "http://127.0.0.1:"
            ) or bridge_url.startswith("http://localhost:")
            if not ok:
                # Un pont non chiffré exposé sur le réseau divulguerait les secrets (§10).
                raise ConfigError(
                    "MT5_BRIDGE_URL doit être en https:// ou en loopback uniquement"
                )
            if not bridge_token or len(bridge_token) < 16:
                raise ConfigError("MT5_BRIDGE_TOKEN manquant ou trop court")

        if terminal_kind == "mt5_gateway":
            if not bridge_url:
                raise ConfigError("MT5_BRIDGE_URL requis avec TERMINAL_KIND=mt5_gateway")
            if not gateway_api_key or len(gateway_api_key) < 16:
                raise ConfigError("MT5_GATEWAY_API_KEY manquant ou trop court")

        return cls(
            backend_url=backend_url,
            engine_id=engine_id,
            auth_secret=auth_secret,
            terminal_kind=terminal_kind,
            bridge_url=bridge_url,
            bridge_token=bridge_token,
            gateway_api_key=gateway_api_key,
            heartbeat_interval_seconds=_int("ENGINE_HEARTBEAT_SECONDS", 15),
            poll_interval_seconds=_int("ENGINE_POLL_SECONDS", 2),
            scan_interval_seconds=_int("ENGINE_SCAN_SECONDS", 5),
            command_ttl_seconds=_int("COMMAND_TTL_SECONDS", 120),
            command_max_age_seconds=_int("ENGINE_COMMAND_MAX_AGE_SECONDS", 110),
            disconnect_after_seconds=_int("ENGINE_DISCONNECT_SECONDS", 60),
            state_dir=os.environ.get("ENGINE_STATE_DIR", "./engine-state"),
            request_timeout_seconds=float(
                os.environ.get("ENGINE_HTTP_TIMEOUT_SECONDS", "10")
            ),
            log_level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        )
