"""Cache en base : durée de vie par clé, repli sur la dernière valeur connue.

Toute donnée renvoyée au frontend passe par `cached` et porte donc sa source,
son horodatage, et un indicateur `stale` (+ l'erreur) si la source a échoué.
"""
import json
import threading
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import HTTPException

from . import db

_locks: dict[str, threading.Lock] = {}
_guard = threading.Lock()


class SourceError(Exception):
    """Erreur explicite d'une source (clé manquante, quota, donnée absente)."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _lock(key: str) -> threading.Lock:
    with _guard:
        return _locks.setdefault(key, threading.Lock())


def _read(key: str):
    with db.conn() as c:
        return c.execute("SELECT payload, source, fetched_at FROM cache WHERE key=?", (key,)).fetchone()


# Nature de la donnée, affichée à côté de la source. Jamais « LIVE » pour une source différée.
LIVE, DELAYED, HISTORICAL, SIMULATED = "LIVE", "DELAYED", "HISTORICAL", "SIMULATED"


def _envelope(row, stale=False, error=None, status=None) -> dict:
    return {"data": json.loads(row["payload"]), "source": row["source"], "status": status,
            "fetched_at": row["fetched_at"], "stale": stale, "error": error}


def cached(key: str, ttl: int, source: str, fetch: Callable[[], Any], force: bool = False, status: str | None = None) -> dict:
    row = _read(key)
    if row and not force:
        age = (_now() - datetime.fromisoformat(row["fetched_at"])).total_seconds()
        if age < ttl:
            return _envelope(row, status=status)
    with _lock(key):
        if not force:
            again = _read(key)
            if again and (not row or again["fetched_at"] != row["fetched_at"]):
                return _envelope(again, status=status)
        try:
            data = fetch()
        except Exception as e:  # repli sur la dernière valeur connue
            msg = str(e) if isinstance(e, SourceError) else f"{type(e).__name__}: {e}"
            if row:
                return _envelope(row, stale=True, error=msg, status=status)
            raise HTTPException(502, detail={"source": source, "error": msg})
        ts = _now().isoformat(timespec="seconds")
        with db.conn() as c:
            c.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?,?)",
                      (key, json.dumps(data, allow_nan=False, default=str), source, ts))
        return {"data": data, "source": source, "status": status, "fetched_at": ts, "stale": False, "error": None}
