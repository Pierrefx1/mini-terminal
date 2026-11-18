"""Yahoo Finance (API publique non officielle) : cours différés, recherche."""
import time
from datetime import datetime, timezone

import httpx
from concurrent.futures import ThreadPoolExecutor

from ..cache import SourceError
from .http import get

BASE = "https://query1.finance.yahoo.com"
# intervalle -> plage maximale servie par Yahoo
MAX_RANGE = {"1m": "5d", "5m": "1mo", "15m": "1mo", "30m": "1mo", "60m": "2y",
             "1d": "max", "1wk": "max", "1mo": "max"}


class Yahoo:
    name = "Yahoo Finance (différé)"

    def _chart(self, symbol: str, interval: str, range_: str, events: bool = False, start: str | None = None) -> dict:
        # Avec range=max, Yahoo dégrade la granularité (cours mensuels) : on borne donc par dates.
        if start or range_ == "max":
            t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp()) if start else 0
            params = {"interval": interval, "period1": t0, "period2": int(time.time()) + 86400}
        else:
            params = {"interval": interval, "range": range_}
        if events:
            params["events"] = "div,splits"
        try:
            j = get(f"{BASE}/v8/finance/chart/{symbol}", params=params).json()["chart"]
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 404:
                raise SourceError(f"Yahoo : symbole « {symbol} » introuvable")
            raise
        if j.get("error") or not j.get("result"):
            raise SourceError(f"Yahoo : symbole « {symbol} » introuvable")
        return j["result"][0]

    def history(self, symbol: str, interval: str = "1d", range_: str = "1y", events: bool = False, start: str | None = None) -> dict:
        if interval not in MAX_RANGE:
            raise SourceError(f"Intervalle non géré : {interval}")
        r = self._chart(symbol, interval, range_, events, start)
        m, q = r["meta"], r["indicators"]["quote"][0]
        ts = r.get("timestamp") or []
        adj = (r["indicators"].get("adjclose") or [{}])[0].get("adjclose")
        candles = []
        for i, t in enumerate(ts):
            o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
            if None in (o, h, l, c):
                continue
            row = {"time": t, "open": o, "high": h, "low": l, "close": c, "volume": q["volume"][i] or 0}
            if adj and adj[i] is not None:
                row["adjclose"] = adj[i]
            candles.append(row)
        out = {"symbol": m["symbol"], "name": m.get("longName") or m.get("shortName") or m["symbol"],
               "currency": m.get("currency"), "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
               "type": m.get("instrumentType"), "tz": m.get("exchangeTimezoneName"),
               "gmtoffset": m.get("gmtoffset", 0), "interval": interval, "candles": candles}
        if events:
            ev = r.get("events", {})
            out["dividends"] = sorted(({"time": d["date"], "amount": d["amount"]} for d in ev.get("dividends", {}).values()), key=lambda x: x["time"])
            out["splits"] = sorted(({"time": s["date"], "ratio": s["numerator"] / s["denominator"]} for s in ev.get("splits", {}).values()), key=lambda x: x["time"])
        return out

    def describe(self, symbol: str) -> dict:
        """Fiche instrument : métadonnées de la place + un an de cours quotidiens."""
        r = self._chart(symbol, "1d", "1y")
        m, q = r["meta"], r["indicators"]["quote"][0]
        candles = [{"time": t, "open": q["open"][i], "high": q["high"][i], "low": q["low"][i], "close": q["close"][i], "volume": q["volume"][i] or 0}
                   for i, t in enumerate(r.get("timestamp") or []) if None not in (q["open"][i], q["high"][i], q["low"][i], q["close"][i])]
        if not candles:
            raise SourceError(f"Yahoo : aucun cours pour « {symbol} »")
        return {"symbol": m["symbol"], "name": m.get("longName") or m.get("shortName") or m["symbol"],
                "currency": m.get("currency"), "exchange": m.get("fullExchangeName") or m.get("exchangeName"),
                "type": m.get("instrumentType"), "tz": m.get("exchangeTimezoneName"), "gmtoffset": m.get("gmtoffset", 0),
                "price": m.get("regularMarketPrice"), "time": m.get("regularMarketTime"),
                "day_high": m.get("regularMarketDayHigh"), "day_low": m.get("regularMarketDayLow"),
                "volume": m.get("regularMarketVolume"), "candles": candles}

    def quote(self, symbol: str) -> dict:
        r = self._chart(symbol, "1d", "5d")
        m = r["meta"]
        closes = [c for c in r["indicators"]["quote"][0]["close"] if c is not None]
        price = m.get("regularMarketPrice")
        # clôture précédente = avant-dernière clôture quotidienne (la dernière est la séance en cours)
        prev = closes[-2] if len(closes) >= 2 else m.get("chartPreviousClose")
        chg = (price - prev) if price is not None and prev else None
        return {"symbol": m["symbol"], "name": m.get("shortName") or m["symbol"], "price": price, "prev_close": prev,
                "change": chg, "change_pct": (chg / prev * 100) if chg is not None else None,
                "currency": m.get("currency"), "time": m.get("regularMarketTime")}

    def quotes(self, symbols: list[str]) -> list[dict]:
        def one(s):
            try:
                return self.quote(s)
            except Exception as e:
                return {"symbol": s, "error": str(e)}
        with ThreadPoolExecutor(4) as ex:
            out = list(ex.map(one, symbols))
        if out and all("error" in q for q in out):  # ne jamais mettre en cache un échec total
            raise SourceError(out[0]["error"])
        return out

    def spark(self, symbols: list[str], range_: str = "1y", interval: str = "1d") -> dict[str, dict]:
        """Clôtures de 20 symboles au plus par appel : {symbole: {t: [...], c: [...]}}."""
        j = get(f"{BASE}/v8/finance/spark", params={"symbols": ",".join(symbols), "range": range_, "interval": interval}).json()
        out = {}
        for s, v in j.items():
            pts = [(t, c) for t, c in zip(v.get("timestamp") or [], v.get("close") or []) if c is not None]
            if pts:
                out[s] = {"t": [p[0] for p in pts], "c": [p[1] for p in pts]}
        return out

    def search(self, query: str) -> list[dict]:
        j = get("https://query2.finance.yahoo.com/v1/finance/search",
                params={"q": query, "quotesCount": 12, "newsCount": 0}).json()
        return [{"symbol": q["symbol"], "name": q.get("longname") or q.get("shortname") or q["symbol"],
                 "type": q.get("quoteType"), "exchange": q.get("exchDisp")} for q in j.get("quotes", []) if q.get("symbol")]
