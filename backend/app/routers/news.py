from fastapi import APIRouter

from .. import db
from ..cache import cached
from ..providers import rss

router = APIRouter(prefix="/api/news", tags=["news"])
COLS = "id,title,link,source,published,summary,theme,country,lang,symbol"


def _store(items: list[dict]) -> None:
    with db.conn() as c:
        c.executemany(f"INSERT OR IGNORE INTO news({COLS}) VALUES (:id,:title,:link,:source,:published,:summary,:theme,:country,:lang,:symbol)", items)
        c.execute("DELETE FROM news WHERE published < datetime('now','-45 days')")


def refresh() -> dict:
    """Rafraîchit chaque flux séparément : un flux en panne ne bloque pas les autres."""
    failed, times = [], []
    for name, url, country, lang, theme in rss.FEEDS:
        try:
            e = cached(f"rss:{name}", 300, name, lambda: rss.parse(name, url, country, lang, theme))
            _store(e["data"])
            times.append(e["fetched_at"])
            if e["stale"]:
                failed.append(f"{name} ({e['error']})")
        except Exception as ex:
            failed.append(f"{name} ({getattr(ex, 'detail', {}).get('error', ex) if hasattr(ex, 'detail') else ex})")
    return {"failed": failed, "fetched_at": min(times) if times else None, "feeds": len(rss.FEEDS)}


@router.get("")
def news(theme: str = "", country: str = "", q: str = "", symbol: str = "", limit: int = 300):
    if symbol:
        e = cached(f"rss:sym:{symbol.upper()}", 300, "Yahoo Finance (RSS)", lambda: rss.symbol_feed(symbol))
        _store(e["data"])
        meta = {"source": e["source"], "fetched_at": e["fetched_at"], "stale": e["stale"], "error": e["error"]}
    else:
        r = refresh()
        meta = {"source": f"RSS ({r['feeds'] - len(r['failed'])}/{r['feeds']} flux)", "fetched_at": r["fetched_at"], "stale": bool(r["failed"]),
                "error": ("Flux en échec : " + " ; ".join(r["failed"])) if r["failed"] else None}
    where, args = ["symbol = ?"], [symbol.upper()]
    if theme:
        where.append("theme = ?"); args.append(theme)
    if country:
        where.append("country = ?"); args.append(country)
    if q:
        where.append("(title LIKE ? OR summary LIKE ?)"); args += [f"%{q}%", f"%{q}%"]
    with db.conn() as c:
        rows = [dict(x) for x in c.execute(f"SELECT {COLS} FROM news WHERE {' AND '.join(where)} ORDER BY published DESC LIMIT ?", (*args, limit))]
        themes = [x[0] for x in c.execute("SELECT theme FROM news WHERE symbol='' GROUP BY theme ORDER BY count(*) DESC")]
    return {"data": {"items": rows, "themes": themes}, **meta}
