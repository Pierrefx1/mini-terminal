"""Cache en base : durée de vie par clé, repli sur la dernière valeur connue.

Toute donnée renvoyée au frontend passe par `cached` et porte donc sa source,
son horodatage, et un indicateur `stale` (+ l'erreur) si la source a échoué.
"""
import json
import threading
import time
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


def record_health(source: str, ok: bool, error: str | None = None, seconds: float | None = None) -> None:
    """Met à jour l'état de la source (page SRC). Ne doit jamais faire échouer la requête de données."""
    ts = _now().isoformat(timespec="seconds")
    ms = None if seconds is None else int(seconds * 1000)
    try:
        with db.conn() as c:
            c.execute("INSERT OR IGNORE INTO source_health (source) VALUES (?)", (source,))
            if ok:
                c.execute("UPDATE source_health SET last_ok=?, ok_count=ok_count+1, last_ms=?, streak=0, down_since=NULL WHERE source=?", (ts, ms, source))
            else:  # streak : échecs consécutifs ; down_since : premier échec de la série
                c.execute("UPDATE source_health SET last_error_at=?, last_error=?, err_count=err_count+1, last_ms=?, streak=streak+1, "
                          "down_since=CASE WHEN streak=0 THEN ? ELSE down_since END WHERE source=?",
                          (ts, (error or "")[:500], ms, ts, source))
    except Exception:
        pass


def _read(key: str):
    with db.conn() as c:
        return c.execute("SELECT payload, source, fetched_at FROM cache WHERE key=?", (key,)).fetchone()


# Nature de la donnée, affichée à côté de la source. Jamais « LIVE » pour une source différée.
LIVE, DELAYED, HISTORICAL, SIMULATED = "LIVE", "DELAYED", "HISTORICAL", "SIMULATED"


def _envelope(row, stale=False, error=None, status=None) -> dict:
    return {"data": json.loads(row["payload"]), "source": row["source"], "status": status,
            "fetched_at": row["fetched_at"], "stale": stale, "error": error}


# ─── Reprise en tâche de fond ───
# Une source en échec (réseau coupé, serveur indisponible) n'était réessayée qu'à la prochaine ouverture de l'écran
# qui l'utilise : elle restait marquée PÉRIMÉ entre-temps. Chaque appel en échec est désormais réessayé seul, avec un
# délai croissant (1, 2, 4… min, plafonné à 15 min), jusqu'au succès ; abandon au bout de 24 h.
RETRY_BASE, RETRY_MAX, RETRY_GIVE_UP = 60, 900, 86400
_retries: dict[str, dict] = {}
_retry_guard = threading.Lock()
_retry_thread: threading.Thread | None = None


def _schedule_retry(key: str, ttl: int, source: str, fetch: Callable[[], Any], status: str | None) -> None:
    global _retry_thread
    now = time.time()
    with _retry_guard:
        r = _retries.get(key)
        n = r["n"] + 1 if r else 0
        _retries[key] = {"ttl": ttl, "source": source, "fetch": fetch, "status": status, "n": n,
                         "since": r["since"] if r else now, "due": now + min(RETRY_BASE * 2 ** n, RETRY_MAX)}
        if _retry_thread is None or not _retry_thread.is_alive():
            _retry_thread = threading.Thread(target=_retry_loop, name="cache-retry", daemon=True)
            _retry_thread.start()


def _retry_loop() -> None:
    while True:
        time.sleep(15)
        now = time.time()
        with _retry_guard:
            for k in [k for k, r in _retries.items() if now - r["since"] > RETRY_GIVE_UP]:
                del _retries[k]
            due = [(k, r) for k, r in _retries.items() if r["due"] <= now]
        for k, r in due:
            try:  # succès : `cached` retire la clé ; échec : `cached` la reprogramme avec un délai plus long
                cached(k, r["ttl"], r["source"], r["fetch"], force=True, status=r["status"])
            except Exception:
                pass


def pending_retries() -> list[dict]:
    """Appels en attente de reprise (page SRC, tests)."""
    with _retry_guard:
        return [{"key": k, "source": r["source"], "attempts": r["n"] + 1, "next_in_s": max(0, int(r["due"] - time.time()))} for k, r in _retries.items()]


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
        t0 = time.monotonic()
        try:
            data = fetch()
        except Exception as e:  # repli sur la dernière valeur connue
            msg = str(e) if isinstance(e, SourceError) else f"{type(e).__name__}: {e}"
            # SourceError = réponse explicite de la source (ticker sans options…) : la source fonctionne
            record_health(source, isinstance(e, SourceError), None if isinstance(e, SourceError) else msg, time.monotonic() - t0)
            if isinstance(e, SourceError):  # la source répond : rien à reprendre
                with _retry_guard:
                    _retries.pop(key, None)
            else:
                _schedule_retry(key, ttl, source, fetch, status)
            if row:
                return _envelope(row, stale=True, error=msg, status=status)
            raise HTTPException(502, detail={"source": source, "error": msg})
        record_health(source, True, None, time.monotonic() - t0)
        with _retry_guard:
            _retries.pop(key, None)
        ts = _now().isoformat(timespec="seconds")
        with db.conn() as c:
            c.execute("INSERT OR REPLACE INTO cache VALUES (?,?,?,?)",
                      (key, json.dumps(data, allow_nan=False, default=str), source, ts))
        return {"data": data, "source": source, "status": status, "fetched_at": ts, "stale": False, "error": None}
