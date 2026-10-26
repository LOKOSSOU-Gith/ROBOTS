"""Journalisation structurée avec masque systématique (§10, §14).

Le masque n'est pas optionnel : il est appliqué dans le handler, donc un
module qui transmettrait `{"password": ...}` par erreur ne peut pas fuiter.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from typing import Any

SENSITIVE_MARKERS = (
    "password",
    "passwd",
    "secret",
    "token",
    "authorization",
    "api_key",
    "apikey",
    "ciphertext",
    "nonce",
    "cookie",
    "credential",
)

# Un mot de passe MT5 est typiquement alphanumérique court ; on masque aussi
# toute valeur associée à une clé sensible, quelle que soit sa forme.
_LOGIN_RE = re.compile(r"\b(login|account|compte)\b[^\w]{0,3}\d{4,16}", re.IGNORECASE)


def _is_sensitive(key: str) -> bool:
    lowered = key.lower().replace("_", "").replace("-", "")
    return any(marker.replace("_", "") in lowered for marker in SENSITIVE_MARKERS)


def redact(obj: Any) -> Any:
    """Copie filtrée : clés sensibles masquées, chaînes suspectes purgées."""
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for key, value in obj.items():
            if _is_sensitive(str(key)):
                out[str(key)] = "[masked]"
            else:
                out[str(key)] = redact(value)
        return out
    if isinstance(obj, (list, tuple)):
        return [redact(item) for item in obj]
    if isinstance(obj, str):
        cleaned = _LOGIN_RE.sub("[masked]", obj)
        return cleaned
    return obj


class RedactingJsonHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:  # noqa: D102 - comportement requis
        safe_fields = getattr(record, "fields", None) or {}
        payload = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": getattr(record, "request_id", None),
        }
        payload.update(redact(dict(safe_fields)))
        if record.exc_info and record.exc_info[1] is not None:
            # La trace ne contient que le type et le message déjà purgés.
            payload["error"] = redact(
                f"{type(record.exc_info[1]).__name__}: {record.exc_info[1]}"
            )
        stream = sys.stderr if record.levelno >= logging.ERROR else sys.stdout
        stream.write(json.dumps(payload, ensure_ascii=False, default=str) + "\n")
        stream.flush()


_configured = False


def _level() -> int:
    return getattr(logging, os.environ.get("LOG_LEVEL", "INFO").upper(), logging.INFO)


def get_logger(name: str = "mt5_engine") -> logging.Logger:
    global _configured
    if not _configured:
        root = logging.getLogger("mt5_engine")
        root.handlers.clear()
        root.setLevel(_level())
        root.addHandler(RedactingJsonHandler())
        root.propagate = False
        _configured = True
    return logging.getLogger(name)


def log_fields(
    level: str,
    msg: str,
    fields: dict[str, Any],
    logger: logging.Logger | None = None,
) -> None:
    """Écrit un événement structuré ; le handler applique le masquage (§10)."""
    (logger or get_logger()).log(
        getattr(logging, level.upper(), logging.INFO),
        msg,
        extra={"fields": fields, "request_id": fields.get("request_id")},
    )
