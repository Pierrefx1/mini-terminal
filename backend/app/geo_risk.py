"""Risque géopolitique mesuré à partir de GDELT : intensité des conflits par pays et écart à la normale.

- `sync()` (tâche planifiée toutes les 5 min) : télécharge les quarts d'heure GDELT manquants des HISTORY_DAYS
  derniers jours, en garde les agrégats par pays et les événements marquants, purge au-delà.
- `country_stats()` : par pays, événements de conflit sur 24 h, moyenne journalière des 7 jours précédents,
  rapport entre les deux (« ×3 vs normale »), tonalité moyenne des articles.
- `notable()` : événements marquants récents, pour les marqueurs du globe.

Au premier lancement, l'historique se constitue en une à deux minutes ; tant que la référence couvre moins
de MIN_BASE_DAYS jours, l'écart à la normale n'est pas calculé.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from . import db
from .cache import record_health
from .providers import gdelt

HISTORY_DAYS = 8          # 24 h courantes + 7 jours de référence
SLOTS_PER_DAY = 96
MISSING_AFTER = timedelta(hours=3)   # un fichier absent au-delà de ce délai ne sera jamais publié
MIN_BASE_DAYS = 3
MIN_BASE = 5.0            # plancher de la moyenne journalière, pour ne pas crier à l'anomalie sur des petits nombres


def _slot(t: datetime) -> str:
    return t.strftime("%Y%m%d%H%M%S")


def _floor(t: datetime) -> datetime:
    return t.replace(minute=t.minute - t.minute % 15, second=0, microsecond=0)


def _slots(now: datetime, days: int) -> list[str]:
    last = _floor(now) - timedelta(minutes=15)
    return [_slot(last - timedelta(minutes=15 * i)) for i in range(days * SLOTS_PER_DAY)]


def sync(now: datetime | None = None, workers: int = 8) -> dict:
    """Télécharge les quarts d'heure manquants (les plus récents d'abord) ; renvoie un résumé."""
    now = now or datetime.now(timezone.utc)
    wanted = _slots(now, HISTORY_DAYS)
    with db.conn() as c:
        done = {r[0] for r in c.execute("SELECT slot FROM gdelt_slots")}
    todo = [s for s in wanted if s not in done]
    t0, ok, missing, errors = time.monotonic(), 0, 0, 0

    def one(slot: str):
        try:
            data = gdelt.fetch(slot)
            return slot, (gdelt.parse(data, slot) if data else None), None
        except Exception as e:  # fichier corrompu ou réseau : nouvel essai au prochain passage
            return slot, None, e

    stamp = now.isoformat(timespec="seconds")
    with ThreadPoolExecutor(workers) as ex:
        for slot, res, err in ex.map(one, todo):
            if err is not None:
                errors += 1
                continue
            if res is None:
                if now - datetime.strptime(slot, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc) > MISSING_AFTER:
                    with db.conn() as c:
                        c.execute("INSERT OR REPLACE INTO gdelt_slots VALUES (?,?,?)", (slot, -1, stamp))
                    missing += 1
                continue
            countries, events = res
            with db.conn() as c:
                c.executemany("INSERT OR REPLACE INTO gdelt_country VALUES (:slot,:iso,:events,:conflict,:material,:articles,:tone_sum)", countries)
                c.executemany("INSERT OR REPLACE INTO gdelt_events VALUES (:id,:slot,:iso,:root,:quad,:goldstein,:articles,:tone,:place,:precise,:lat,:lon,:actor1,:actor2,:url)", events)
                c.execute("INSERT OR REPLACE INTO gdelt_slots VALUES (?,?,?)", (slot, sum(x["events"] for x in countries), stamp))
            ok += 1
    oldest = wanted[-1]
    with db.conn() as c:
        for t in ("gdelt_slots", "gdelt_country", "gdelt_events"):
            c.execute(f"DELETE FROM {t} WHERE slot < ?", (oldest,))
    if todo:
        record_health(gdelt.NAME, errors < max(1, len(todo) // 2), f"{errors} fichiers en échec" if errors else None, time.monotonic() - t0)
    return {"todo": len(todo), "ok": ok, "missing": missing, "errors": errors}


def coverage(now: datetime | None = None) -> dict:
    """Part des quarts d'heure disponibles : 24 dernières heures et référence (7 jours précédents)."""
    now = now or datetime.now(timezone.utc)
    s24, sbase = _slot(now - timedelta(hours=24)), _slot(now - timedelta(days=HISTORY_DAYS))
    with db.conn() as c:
        n24 = c.execute("SELECT count(*) FROM gdelt_slots WHERE n >= 0 AND slot >= ?", (s24,)).fetchone()[0]
        nb = c.execute("SELECT count(*) FROM gdelt_slots WHERE n >= 0 AND slot >= ? AND slot < ?", (sbase, s24)).fetchone()[0]
        last = c.execute("SELECT max(slot) FROM gdelt_slots WHERE n >= 0").fetchone()[0]
    return {"last24": n24 / SLOTS_PER_DAY, "base_days": nb / SLOTS_PER_DAY,
            "last_slot": datetime.strptime(last, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat() if last else None}


def country_stats(now: datetime | None = None) -> dict[str, dict]:
    """iso -> conflict24, material24, articles24, tone, base (moyenne/jour sur la référence) et ratio : part du pays dans les
    conflits mondiaux des 24 h / sa part sur la référence (None si référence trop courte). ×2 = deux fois plus présent que d'habitude."""
    now = now or datetime.now(timezone.utc)
    cov = coverage(now)
    s24, sbase = _slot(now - timedelta(hours=24)), _slot(now - timedelta(days=HISTORY_DAYS))
    with db.conn() as c:
        cur = {r["iso"]: dict(r) for r in c.execute(
            "SELECT iso, sum(conflict) conflict, sum(material) material, sum(articles) articles, sum(tone_sum) tone_sum, sum(events) events "
            "FROM gdelt_country WHERE slot >= ? GROUP BY iso", (s24,))}
        base = {r["iso"]: r["conflict"] for r in c.execute(
            "SELECT iso, sum(conflict) conflict FROM gdelt_country WHERE slot >= ? AND slot < ? GROUP BY iso", (sbase, s24))}
    # Le volume médiatique varie (week-ends, actualité chargée ailleurs) : on compare la PART du pays dans les conflits
    # recensés dans le monde, rapportée à sa part habituelle, plutôt que des nombres bruts.
    tot24, totb = sum(x["conflict"] or 0 for x in cur.values()), sum(base.values())
    scale = 1 / cov["last24"] if cov["last24"] >= 0.5 else 1.0  # 24 h incomplètes : on extrapole
    out = {}
    for iso in set(cur) | set(base):
        x = cur.get(iso, {})
        c24 = round((x.get("conflict") or 0) * scale)
        b = (base.get(iso, 0) / cov["base_days"]) if cov["base_days"] > 0 else None
        ratio = None
        if b is not None and cov["base_days"] >= MIN_BASE_DAYS and tot24 and totb:
            expected = max(b, MIN_BASE) / (totb / cov["base_days"]) * (tot24 * scale)  # nombre attendu à part habituelle
            ratio = round(c24 / expected, 2)
        out[iso] = {"iso": iso, "conflict24": c24, "material24": round((x.get("material") or 0) * scale), "articles24": round((x.get("articles") or 0) * scale),
                    "events24": round((x.get("events") or 0) * scale), "tone": round(x["tone_sum"] / x["conflict"], 2) if x.get("conflict") else None,
                    "base": round(b, 1) if b is not None else None, "ratio": ratio}
    return out


def notable(hours: int = 72, min_articles: int = 3, limit: int = 160, now: datetime | None = None) -> list[dict]:
    """Événements marquants récents, regroupés par (pays, famille, lieu) sur la période, les plus repris d'abord."""
    now = now or datetime.now(timezone.utc)
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM gdelt_events WHERE slot >= ? ORDER BY articles DESC", (_slot(now - timedelta(hours=hours)),))]
    groups: dict[tuple, dict] = {}
    for r in rows:
        k = gdelt.notable_key(r["iso"], r["root"], r["lat"], r["lon"])
        g = groups.get(k)
        if g is None:
            groups[k] = {**r, "reports": 1, "first": r["slot"], "last": r["slot"]}
        else:
            g["articles"] += r["articles"]; g["reports"] += 1
            g["first"], g["last"] = min(g["first"], r["slot"]), max(g["last"], r["slot"])
    out = [g for g in groups.values() if g["articles"] >= min_articles]
    out.sort(key=lambda g: -g["articles"])
    for g in out:
        g["time"] = datetime.strptime(g["last"], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat()
    return out[:limit]
