import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter

from .. import db
from ..cache import cached
from ..providers.forexfactory import ForexFactory
from ..providers.nasdaq_calendar import NasdaqCalendar, match

router = APIRouter(prefix="/api/calendar", tags=["calendrier"])
provider = ForexFactory()
nasdaq = NasdaqCalendar()
ACTUAL_DAYS = 14  # recherche des chiffres publiés sur les deux dernières semaines
NUM = re.compile(r"^(-?\d+(?:\.\d+)?)\s*([%KMBT]?)$")


def _num(s: str):
    m = NUM.match(s.replace(",", "").strip()) if s else None
    return (float(m.group(1)), m.group(2)) if m else None


def refresh() -> dict:
    e = cached("calendar:week", 3600, provider.name, provider.events)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    with db.conn() as c:  # historisation : les semaines passées restent consultables
        c.executemany("INSERT INTO calendar_events(id,title,country,time,impact,forecast,previous,updated_at) VALUES (:id,:title,:country,:time,:impact,:forecast,:previous,'%s') "
                      "ON CONFLICT(id) DO UPDATE SET time=excluded.time, impact=excluded.impact, forecast=excluded.forecast, previous=excluded.previous, updated_at=excluded.updated_at" % now, e["data"])
    return e


def _nasdaq_page(d: date) -> list[dict]:
    recent = (date.today() - d).days <= 2  # chiffres du jour : rafraîchis ; jours passés : figés
    try:
        return cached(f"nasdaq-cal:{d}", 15 * 60 if recent else 7 * 86400, nasdaq.name, lambda: nasdaq.page(d))["data"]
    except Exception:  # source indisponible : on garde le repli sur le « précédent » suivant
        return []


def fill_actuals() -> None:
    """Complète en base le chiffre publié des événements passés qui n'en ont pas encore."""
    now = datetime.now(timezone.utc)
    with db.conn() as c:
        todo = [dict(r) for r in c.execute("SELECT id,title,country,time,forecast,previous FROM calendar_events WHERE actual = '' AND time >= ? AND time <= ?",
                                           ((now - timedelta(days=ACTUAL_DAYS)).isoformat(), now.isoformat()))]
    if not todo:
        return
    # une journée UTC d tombe sur la journée new-yorkaise d ou d-1 ; Nasdaq range la journée new-yorkaise d sur la page d+1
    pages = sorted({date.fromisoformat(e["time"][:10]) + timedelta(days=k) for e in todo for k in (0, 1)})
    with ThreadPoolExecutor(6) as ex:
        rows = [r for page in ex.map(_nasdaq_page, pages) for r in page]
    found = match(todo, rows)
    if found:
        with db.conn() as c:
            c.executemany("UPDATE calendar_events SET actual = ? WHERE id = ?", [(a, i) for i, a in found.items()])


@router.get("")
def calendar(start: str = "", end: str = ""):
    e = refresh()
    fill_actuals()
    where, args = [], []
    if start:
        where.append("time >= ?"); args.append(start)
    if end:
        where.append("time <= ?"); args.append(end)
    with db.conn() as c:
        rows = [dict(r) for r in c.execute(f"SELECT id,title,country,time,impact,forecast,previous,actual FROM calendar_events {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY time", args)]
        first = c.execute("SELECT min(time) FROM calendar_events").fetchone()[0]
        # Le « précédent » de la publication suivante donne le chiffre réel (éventuellement révisé) d'une publication passée.
        nxt = {}
        for r in c.execute("SELECT title,country,time,previous FROM calendar_events WHERE previous != '' ORDER BY time DESC"):
            nxt.setdefault((r["title"], r["country"]), []).append((r["time"], r["previous"]))
    for r in rows:
        later = [p for t, p in nxt.get((r["title"], r["country"]), []) if t > r["time"]]
        # chiffre publié (Nasdaq), sinon le « précédent » de la publication suivante (éventuellement révisé)
        r["actual_src"] = "nasdaq" if r["actual"] else "derived" if later else ""
        r["actual"] = r["actual"] or (later[-1] if later else "")
        a, f = _num(r["actual"]), _num(r["forecast"])
        r["surprise"] = round(a[0] - f[0], 4) if a and f and a[1] == f[1] else None
    return {"data": {"events": rows, "history_from": first}, "source": e["source"], "fetched_at": e["fetched_at"], "stale": e["stale"], "error": e["error"]}
