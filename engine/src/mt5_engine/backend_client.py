"""Client backend sortant (§8.1, §12.3).

Le moteur n'expose aucun port : il initie des requêtes HTTPS sortantes vers
le backend, avec le jeton de service et son identifiant. Les corps de requêtes
et réponses transitent par le masque de `logs.redact` avant toute
journalisation (§9.1).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import requests

from .config import EngineConfig
from .logs import get_logger

log = get_logger("mt5_engine.api")


class BackendError(RuntimeError):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"backend: {status} {code}")
        self.status = status
        self.code = code


class TransientBackendError(BackendError):
    """Erreur réseau ou 5xx : la commande n'est pas perdue, elle est réessayée."""


@dataclass(frozen=True)
class Command:
    id: str
    instance_id: str
    type: str
    payload: dict
    expires_at: str
    attempt: int

    def seconds_remaining(self, now: datetime | None = None) -> float:
        try:
            expiry = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        except ValueError:
            return -1.0
        reference = now or datetime.now(timezone.utc)
        return (expiry - reference).total_seconds()


class BackendClient:
    def __init__(self, config: EngineConfig) -> None:
        self._config = config
        self._session = requests.Session()
        self._session.headers.update(
            {
                "Authorization": f"Bearer {config.auth_secret}",
                "x-engine-id": config.engine_id,
                "content-type": "application/json",
            }
        )

    # ------------------------------------------------------------- transport

    def _request(self, method: str, path: str, payload: dict | None = None) -> Any:
        url = f"{self._config.backend_url}/api/v1{path}"
        try:
            response = self._session.request(
                method, url, json=payload, timeout=self._config.request_timeout_seconds
            )
        except requests.RequestException as exc:
            raise TransientBackendError(0, type(exc).__name__) from exc

        if response.status_code >= 500:
            raise TransientBackendError(response.status_code, "backend_unavailable")
        if response.status_code == 429:
            raise TransientBackendError(429, "rate_limited")
        if response.status_code >= 400:
            code = "error"
            try:
                code = str(response.json().get("error", {}).get("code", code))
            except ValueError:
                pass
            raise BackendError(response.status_code, code)

        body = response.json()
        return body.get("data", body)

    # --------------------------------------------------------------- contrats

    def heartbeat(self, payload: dict) -> dict:
        return self._request("POST", "/engine/heartbeat", payload)

    def next_command(self) -> Command | None:
        data = self._request("GET", "/engine/commands/pending")
        raw = (data or {}).get("command")
        if not raw:
            return None
        return Command(
            id=str(raw["id"]),
            instance_id=str(raw["instance_id"]),
            type=str(raw["type"]),
            payload=dict(raw.get("payload") or {}),
            expires_at=str(raw["expires_at"]),
            attempt=int(raw.get("attempt", 1)),
        )

    def ack(
        self,
        command_id: str,
        ack: str,
        *,
        code: str | None = None,
        message: str | None = None,
        observed_state: str | None = None,
        detail: dict | None = None,
    ) -> dict:
        body: dict[str, Any] = {"command_id": command_id, "ack": ack}
        if code:
            body["code"] = code
        # Un message d'erreur ne doit jamais contenir d'identifiant (§10).
        if message:
            body["message"] = message[:300]
        if observed_state:
            body["observed_state"] = observed_state
        if detail:
            body["detail"] = detail
        return self._request("POST", "/engine/commands/ack", body)

    def instance_runtime(self, instance_id: str) -> dict:
        return self._request("GET", f"/engine/instances/{instance_id}/runtime")

    def reveal_secret(self, account_id: str, purpose: str, nonce: str) -> str:
        """Le secret traverse cette méthode et n'est jamais journalisé (§10)."""
        data = self._request(
            "POST",
            f"/engine/accounts/{account_id}/secret",
            {"purpose": purpose, "nonce": nonce},
        )
        secret = (data or {}).get("secret")
        if not isinstance(secret, str) or not secret:
            raise BackendError(502, "secret_unavailable")
        return secret

    def push_events(
        self,
        trading_account_id: str,
        instance_id: str | None,
        events: list[dict],
        positions: list[dict],
        account: dict | None = None,
    ) -> dict:
        body = {
            "trading_account_id": trading_account_id,
            "instance_id": instance_id,
            "events": events,
            "positions": positions,
        }
        if account:
            body["account"] = account
        return self._request("POST", "/engine/events", body)

    def pending_connection_tests(self) -> list[dict]:
        data = self._request("GET", "/engine/connection-tests")
        return list((data or {}).get("tests", []))

    def ack_connection_test(
        self, connection_test_id: str, status: str, code: str, message: str
    ) -> dict:
        return self._request(
            "POST",
            "/engine/connection-tests",
            {
                "connection_test_id": connection_test_id,
                "status": status,
                "code": code,
                # message technique déjà purgé par le moteur (§10)
                "message": message[:300],
            },
        )

    def close(self) -> None:
        self._session.close()
