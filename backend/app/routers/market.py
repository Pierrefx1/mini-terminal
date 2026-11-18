from fastapi import APIRouter, HTTPException, Query

from .. import db
from ..cache import DELAYED, cached
from ..providers.registry import prices

router = APIRouter(prefix="/api/market", tags=["marché"])

TTL = {"1m": 60, "5m": 120, "15m": 300, "30m": 300, "60m": 600, "1d": 900, "1wk": 3600, "1mo": 3600}
TICKER = ["^GSPC", "^NDX", "^STOXX50E", "^FCHI", "^GDAXI", "^N225", "^VIX", "^TNX",
          "EURUSD=X", "USDJPY=X", "DX-Y.NYB", "GC=F", "CL=F", "BZ=F", "BTC-USD"]


@router.get("/history")
def history(symbol: str, interval: str = "1d", range_: str = Query("1y", alias="range")):
    if interval not in TTL:
        raise HTTPException(400, f"Intervalle inconnu : {interval}")
    return cached(f"hist:{symbol}:{interval}:{range_}", TTL[interval], prices.name,
                  lambda: prices.history(symbol, interval, range_), status=DELAYED)


@router.get("/search")
def search(q: str):
    return cached(f"search:{q.lower()}", 86400, prices.name, lambda: prices.search(q))


@router.get("/quotes")
def quotes(symbols: str):
    syms = [s for s in symbols.split(",") if s]
    return cached("quotes:" + ",".join(syms), 60, prices.name, lambda: prices.quotes(syms), status=DELAYED)


@router.get("/ticker")
def ticker():
    return cached("ticker", 60, prices.name, lambda: prices.quotes(TICKER), status=DELAYED)


@router.get("/watchlist")
def watchlist():
    with db.conn() as c:
        syms = [r["symbol"] for r in c.execute("SELECT symbol FROM watchlist ORDER BY position, rowid")]
    if not syms:
        return {"data": [], "source": prices.name, "fetched_at": None, "stale": False, "error": None}
    return cached("quotes:" + ",".join(syms), 60, prices.name, lambda: prices.quotes(syms), status=DELAYED)


@router.put("/watchlist/{symbol}")
def watch_add(symbol: str):
    with db.conn() as c:
        c.execute("INSERT OR IGNORE INTO watchlist(symbol, position) VALUES (?, (SELECT COALESCE(MAX(position),0)+1 FROM watchlist))", (symbol.upper(),))
    return {"ok": True}


@router.delete("/watchlist/{symbol}")
def watch_del(symbol: str):
    with db.conn() as c:
        c.execute("DELETE FROM watchlist WHERE symbol=?", (symbol.upper(),))
    return {"ok": True}
