"""File et journal locaux du moteur (§8.1).

Deux responsabilités :

1. persister les commandes déjà traitées pour qu'un redémarrage ne rejoue
   jamais un démarrage (§13 T4 : aucun démarrage involontaire en double) ;
2. tamponner les événements et positions non encore publiés, pour survivre à
   une coupure réseau avec le backend (§14).

SQLite est choisi pour sa présence en bibliothèque standard et son mode
journal WAL, pas pour la performance.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from contextlib import closing
from dataclasses import dataclass

_SCHEMA = """
CREATE TABLE IF NOT EXISTS processed_commands (
  command_id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  type TEXT NOT NULL,
  final_ack TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  account_id TEXT,
  instance_id TEXT,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS instance_state (
  instance_id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  state TEXT NOT NULL,
  previous_loss_occurred INTEGER NOT NULL DEFAULT 0,
  peak_equity TEXT NOT NULL DEFAULT '0',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_due_idx ON outbox (created_at);
"""


@dataclass(frozen=True)
class OutboxItem:
    id: int
    kind: str
    account_id: str | None
    instance_id: str | None
    body: dict
    attempts: int


class EngineStore:
    def __init__(self, state_dir: str) -> None:
        os.makedirs(state_dir, exist_ok=True)
        self._path = os.path.join(state_dir, "engine-state.sqlite3")
        self._lock = threading.Lock()
        self._connection = sqlite3.connect(self._path, check_same_thread=False)
        self._connection.execute("PRAGMA journal_mode=WAL")
        with closing(self._connection.cursor()) as cursor:
            cursor.executescript(_SCHEMA)
        self._connection.commit()

    def close(self) -> None:
        with self._lock:
            self._connection.close()

    # -------------------------------------------------- idempotence moteur

    def was_processed(self, command_id: str) -> bool:
        with self._lock:
            row = self._connection.execute(
                "SELECT 1 FROM processed_commands WHERE command_id = ?", (command_id,)
            ).fetchone()
        return row is not None

    def mark_processed(self, command_id: str, instance_id: str, command_type: str, final_ack: str) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT OR IGNORE INTO processed_commands "
                "(command_id, instance_id, type, final_ack, processed_at) VALUES (?, ?, ?, ?, ?)",
                (command_id, instance_id, command_type, final_ack, int(time.time())),
            )
            self._connection.commit()

    def purge_processed_older_than(self, seconds: int) -> int:
        """L'historique local est borné : la rétention suit la TTL métier (§14)."""
        threshold = int(time.time()) - seconds
        with self._lock:
            cursor = self._connection.execute(
                "DELETE FROM processed_commands WHERE processed_at < ?", (threshold,)
            )
            self._connection.commit()
        return cursor.rowcount or 0

    # ------------------------------------------------------------- outbox

    def enqueue(
        self, kind: str, body: dict, account_id: str | None, instance_id: str | None
    ) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT INTO outbox (kind, account_id, instance_id, body, created_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (kind, account_id, instance_id, json.dumps(body), int(time.time())),
            )
            self._connection.commit()

    def next_outbox(self, limit: int = 25) -> list[OutboxItem]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT id, kind, account_id, instance_id, body, attempts "
                "FROM outbox ORDER BY id LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            OutboxItem(
                id=int(row[0]),
                kind=str(row[1]),
                account_id=row[2],
                instance_id=row[3],
                body=json.loads(row[4]),
                attempts=int(row[5]),
            )
            for row in rows
        ]

    def delete_outbox(self, item_id: int) -> None:
        with self._lock:
            self._connection.execute("DELETE FROM outbox WHERE id = ?", (item_id,))
            self._connection.commit()

    def bump_outbox_attempts(self, item_id: int) -> None:
        with self._lock:
            self._connection.execute(
                "UPDATE outbox SET attempts = attempts + 1 WHERE id = ?", (item_id,)
            )
            self._connection.commit()

    def outbox_depth(self) -> int:
        with self._lock:
            row = self._connection.execute("SELECT COUNT(*) FROM outbox").fetchone()
        return int(row[0]) if row else 0

    # ------------------------------------------------------ état d'instance

    def get_instance(self, instance_id: str) -> dict | None:
        with self._lock:
            row = self._connection.execute(
                "SELECT owner_user_id, account_id, state, previous_loss_occurred, "
                "peak_equity FROM instance_state WHERE instance_id = ?",
                (instance_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            "owner_user_id": row[0],
            "account_id": row[1],
            "state": row[2],
            "previous_loss_occurred": bool(row[3]),
            "peak_equity": row[4],
        }

    def upsert_instance(
        self,
        instance_id: str,
        owner_user_id: str,
        account_id: str,
        state: str,
        previous_loss_occurred: bool,
        peak_equity: str,
    ) -> None:
        with self._lock:
            self._connection.execute(
                "INSERT INTO instance_state "
                "(instance_id, owner_user_id, account_id, state, previous_loss_occurred, "
                "peak_equity, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(instance_id) DO UPDATE SET "
                "owner_user_id=excluded.owner_user_id, account_id=excluded.account_id, "
                "state=excluded.state, previous_loss_occurred=excluded.previous_loss_occurred, "
                "peak_equity=excluded.peak_equity, updated_at=excluded.updated_at",
                (
                    instance_id,
                    owner_user_id,
                    account_id,
                    state,
                    1 if previous_loss_occurred else 0,
                    peak_equity,
                    int(time.time()),
                ),
            )
            self._connection.commit()

    def list_instances(self) -> list[dict]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT instance_id, owner_user_id, account_id, state, "
                "previous_loss_occurred, peak_equity FROM instance_state"
            ).fetchall()
        return [
            {
                "instance_id": row[0],
                "owner_user_id": row[1],
                "account_id": row[2],
                "state": row[3],
                "previous_loss_occurred": bool(row[4]),
                "peak_equity": row[5],
            }
            for row in rows
        ]

    def note_loss_occurred(self, instance_id: str) -> None:
        """Marque qu'une perte réalisée est survenue (signal anti-Martingale §6.1).

        Le drapeau sert uniquement à refuser une hausse de lot ; il n'entre
        jamais dans le calcul du volume de référence.
        """
        with self._lock:
            self._connection.execute(
                "UPDATE instance_state SET previous_loss_occurred = 1, updated_at = ? "
                "WHERE instance_id = ?",
                (int(time.time()), instance_id),
            )
            self._connection.commit()
