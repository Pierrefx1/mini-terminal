"""CBOE : chaînes d'options cotées aux États-Unis (cours différés, grecques et volatilité implicite calculées par la CBOE)."""
import re
from datetime import date

import httpx

from ..cache import SourceError
from .http import get

BASE = "https://cdn.cboe.com/api/global/delayed_quotes"
# indices : préfixe « _ » chez la CBOE
INDEX = {"^GSPC": "_SPX", "^SPX": "_SPX", "^NDX": "_NDX", "^RUT": "_RUT", "^VIX": "_VIX", "^DJI": "_DJX", "^XSP": "_XSP"}
OCC = re.compile(r"^(?P<root>[A-Z]+\d?)(?P<y>\d{2})(?P<m>\d{2})(?P<d>\d{2})(?P<cp>[CP])(?P<k>\d{8})$")


def cboe_symbol(symbol: str) -> str:
    return INDEX.get(symbol.upper(), symbol.upper().lstrip("^"))


class Cboe:
    name = "CBOE (différé)"

    def chain(self, symbol: str) -> dict:
        try:
            r = get(f"{BASE}/options/{cboe_symbol(symbol)}.json")
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 403:  # reste une panne (compte dans SRC), avec la marche à suivre
                raise RuntimeError("CBOE refuse les appels automatisés (403). Configurer Tradier : TRADIER_API_KEY dans .env "
                                   "(clé gratuite d'un compte développeur), puis relancer le terminal.") from e
            raise
        try:
            d = r.json()["data"]
        except Exception:
            raise SourceError(f"CBOE : pas d'options cotées pour « {symbol} » (seules les options américaines sont couvertes)")
        rows = []
        for o in d.get("options", []):
            m = OCC.match(o["option"])
            if not m:
                continue
            rows.append({"expiry": f"20{m['y']}-{m['m']}-{m['d']}", "type": "call" if m["cp"] == "C" else "put", "strike": int(m["k"]) / 1000,
                         "bid": o.get("bid"), "ask": o.get("ask"), "last": o.get("last_trade_price"), "iv": o.get("iv") or None,
                         "delta": o.get("delta"), "gamma": o.get("gamma"), "vega": o.get("vega"), "theta": o.get("theta"), "rho": o.get("rho"),
                         "theo": o.get("theo"), "volume": o.get("volume"), "oi": o.get("open_interest"), "change": o.get("change")})
        if not rows:
            raise SourceError(f"CBOE : chaîne vide pour « {symbol} »")
        return {"symbol": symbol, "underlying": d.get("current_price"), "iv30": d.get("iv30"), "bid": d.get("bid"), "ask": d.get("ask"),
                "timestamp": r.json().get("timestamp"), "today": date.today().isoformat(), "options": rows}

    def quote(self, symbol: str) -> dict:
        d = get(f"{BASE}/quotes/{cboe_symbol(symbol)}.json").json()["data"]
        return {k: d.get(k) for k in ("symbol", "current_price", "bid", "ask", "bid_size", "ask_size", "volume", "iv30", "last_trade_time", "prev_day_close")}
