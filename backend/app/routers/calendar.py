import re
from datetime import datetime, timezone

from fastapi import APIRouter

from .. import db
from ..cache import cached
from ..providers.forexfactory import ForexFactory

router = APIRouter(prefix="/api/calendar", tags=["calendrier"])
provider = ForexFactory()
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


@router.get("")
def calendar(start: str = "", end: str = ""):
    e = refresh()
    where, args = [], []
    if start:
        where.append("time >= ?"); args.append(start)
    if end:
        where.append("time <= ?"); args.append(end)
    with db.conn() as c:
        rows = [dict(r) for r in c.execute(f"SELECT id,title,country,time,impact,forecast,previous FROM calendar_events {'WHERE ' + ' AND '.join(where) if where else ''} ORDER BY time", args)]
        first = c.execute("SELECT min(time) FROM calendar_events").fetchone()[0]
        # Le « précédent » de la publication suivante donne le chiffre réel (éventuellement révisé) d'une publication passée.
        nxt = {}
        for r in c.execute("SELECT title,country,time,previous FROM calendar_events WHERE previous != '' ORDER BY time DESC"):
            nxt.setdefault((r["title"], r["country"]), []).append((r["time"], r["previous"]))
    for r in rows:
        later = [p for t, p in nxt.get((r["title"], r["country"]), []) if t > r["time"]]
        r["actual"] = later[-1] if later else ""
        a, f = _num(r["actual"]), _num(r["forecast"])
        r["surprise"] = round(a[0] - f[0], 4) if a and f and a[1] == f[1] else None
    return {"data": {"events": rows, "history_from": first}, "source": e["source"], "fetched_at": e["fetched_at"], "stale": e["stale"], "error": e["error"]}
