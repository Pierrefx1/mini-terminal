"""Options (OMON) : chaînes Yahoo Finance via yfinance (différé, gratuit, sans clé), grecques calculées par le terminal.

Remplace CBOE, qui refuse désormais les appels automatisés (403). Même source que la surface VOL.
Yahoo fournit cours, bid/ask, volume, intérêt ouvert et une volatilité implicite, mais pas de grecques :
- forward de chaque échéance déduit de la parité call-put sur les strikes proches de la monnaie (comme VOL) : il
  intègre dividendes et décalage entre le dernier cours du sous-jacent et les prix des options (week-end, hors séance) ;
- volatilité implicite recalculée sur le milieu bid/ask (Black-76 sur ce forward), la valeur Yahoo ne servant qu'en
  repli (souvent aberrante quand le bid est nul) ;
- grecques et valeur théorique : Black-Scholes sur le cours équivalent F·e^{-rT}, taux sans risque `RATE`.
Les fonctions de calcul sont pures et testées dans tests/test_yahoo_options.py.
"""
from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import date, datetime, timezone

from scipy.stats import norm

from ..cache import SourceError
from ..vol_surface import implied_vol

RATE = 0.04            # taux sans risque approché (même hypothèse que VOL)
MAX_EXPIRIES = 14      # échéances chargées : toutes les proches puis un échantillon (Yahoo limite les requêtes)
NEAR_DAYS = 45
MAX_DAYS = 760
TIMEOUT = 45.0
# indices : symbole des options sur Yahoo
INDEX = {"^GSPC": "^SPX", "^SPX": "^SPX", "^NDX": "^NDX", "^RUT": "^RUT", "^VIX": "^VIX", "^DJI": "^DJX", "^XSP": "^XSP"}


def yahoo_symbol(symbol: str) -> str:
    return INDEX.get(symbol.upper(), symbol.upper())


def pick_expiries(dates: list[str], today: date, n: int = MAX_EXPIRIES) -> list[str]:
    """Toutes les échéances des NEAR_DAYS prochains jours (au plus n/2), puis un échantillon régulier des suivantes
    jusqu'à MAX_DAYS, première et dernière comprises : couvre la surface sans épuiser la limite de requêtes."""
    future = sorted(d for d in dates if 0 <= (date.fromisoformat(d) - today).days <= MAX_DAYS)
    near = [d for d in future if (date.fromisoformat(d) - today).days <= NEAR_DAYS][: max(1, n // 2)]
    far = [d for d in future if d not in near and d > (near[-1] if near else "")]
    room = n - len(near)
    if len(far) > room > 0:
        far = [far[0]] if room == 1 else [far[round(i * (len(far) - 1) / (room - 1))] for i in range(room)]
    elif room <= 0:
        far = []
    return sorted(set(near + far))


def greeks(S: float, K: float, T: float, vol: float, is_call: bool, r: float = RATE) -> dict:
    """Black-Scholes sans dividende. vega et rho pour 1 point (1 %), theta par jour calendaire."""
    if not (S > 0 and K > 0 and T > 0 and vol and vol > 0):
        return {"delta": None, "gamma": None, "vega": None, "theta": None, "rho": None, "theo": None}
    sd = vol * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * vol * vol) * T) / sd
    d2 = d1 - sd
    disc, pdf = math.exp(-r * T), norm.pdf(d1)
    if is_call:
        theo = S * norm.cdf(d1) - K * disc * norm.cdf(d2)
        delta, rho = norm.cdf(d1), K * T * disc * norm.cdf(d2) / 100
        theta = (-S * pdf * vol / (2 * math.sqrt(T)) - r * K * disc * norm.cdf(d2)) / 365
    else:
        theo = K * disc * norm.cdf(-d2) - S * norm.cdf(-d1)
        delta, rho = norm.cdf(d1) - 1, -K * T * disc * norm.cdf(-d2) / 100
        theta = (-S * pdf * vol / (2 * math.sqrt(T)) + r * K * disc * norm.cdf(-d2)) / 365
    return {"delta": delta, "gamma": pdf / (S * sd), "vega": S * pdf * math.sqrt(T) / 100, "theta": theta, "rho": rho, "theo": theo}


def _num(v) -> float | None:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def implied_forward(calls: list[dict], puts: list[dict], spot: float, T: float, n: int = 5) -> float:
    """Forward par parité call-put : F = K + (C − P)·e^{rT}, médiane sur les n strikes cotés des deux côtés les plus
    proches du cours. À défaut, S·e^{rT}."""
    mid = lambda o: (o["bid"] + o["ask"]) / 2 if (_num(o.get("bid")) or 0) > 0 and (_num(o.get("ask")) or 0) >= o["bid"] else None
    cm = {_num(o.get("strike")): mid(o) for o in calls}
    pm = {_num(o.get("strike")): mid(o) for o in puts}
    ks = sorted((k for k in cm if k and cm[k] and pm.get(k)), key=lambda k: abs(k - spot))[:n]
    if not ks or T <= 0:
        return spot * math.exp(RATE * T)
    fs = sorted(k + (cm[k] - pm[k]) * math.exp(RATE * T) for k in ks)
    return fs[len(fs) // 2]


def row(o: dict, expiry: str, is_call: bool, S: float, T: float) -> dict:
    """Ligne yfinance (strike, bid, ask, lastPrice, volume, openInterest, impliedVolatility, change) -> ligne du terminal.
    S : cours équivalent de l'échéance (forward actualisé F·e^{-rT})."""
    K, bid, ask = _num(o.get("strike")), _num(o.get("bid")), _num(o.get("ask"))
    iv = None
    if K and bid and ask and ask >= bid > 0 and T > 0:
        x = implied_vol((bid + ask) / 2, S * math.exp(RATE * T), K, T, math.exp(-RATE * T), is_call)
        iv = x if x == x else None  # NaN : prix hors bornes d'arbitrage
    if iv is None:
        y = _num(o.get("impliedVolatility"))
        iv = y if y and 0.01 <= y <= 5 else None
    g = greeks(S, K or 0, T, iv or 0, is_call)
    vol_, oi = _num(o.get("volume")), _num(o.get("openInterest"))
    return {"expiry": expiry, "type": "call" if is_call else "put", "strike": K, "bid": bid, "ask": ask, "last": _num(o.get("lastPrice")),
            "iv": iv, **g, "volume": int(vol_) if vol_ is not None else None, "oi": int(oi) if oi is not None else None, "change": _num(o.get("change"))}


def iv30(rows: list[dict], spot: float, today: date) -> float | None:
    """Volatilité implicite à la monnaie interpolée à 30 jours (en %), CBOE ne fournissant plus son indice."""
    by_exp: dict[str, list[dict]] = {}
    for r in rows:
        if r["iv"]:
            by_exp.setdefault(r["expiry"], []).append(r)
    atm = []
    for e, rs in by_exp.items():
        days = (date.fromisoformat(e) - today).days
        if days <= 0:
            continue
        k = min(rs, key=lambda r: abs(r["strike"] - spot))["strike"]
        ivs = [r["iv"] for r in rs if r["strike"] == k]
        atm.append((days, sum(ivs) / len(ivs)))
    if not atm:
        return None
    atm.sort()
    below, above = [a for a in atm if a[0] <= 30], [a for a in atm if a[0] >= 30]
    if below and above:
        (d1, v1), (d2, v2) = below[-1], above[0]
        v = v1 if d1 == d2 else v1 + (v2 - v1) * (30 - d1) / (d2 - d1)
    else:
        v = below[-1][1] if below else above[0][1]
    return round(v * 100, 2)


class YahooOptions:
    name = "Yahoo Finance via yfinance (options)"

    def _fetch(self, symbol: str) -> dict:
        import yfinance as yf

        ysym, today = yahoo_symbol(symbol), date.today()
        tk = yf.Ticker(ysym)
        dates = list(tk.options or [])
        if not dates:
            raise SourceError(f"Yahoo : pas d'options cotées pour « {symbol} » (seules les options américaines sont couvertes)")
        spot = _num(tk.fast_info["last_price"])
        if not spot or spot <= 0:
            raise SourceError(f"Yahoo : cours de « {symbol} » indisponible")
        exps = pick_expiries(dates, today)
        now = datetime.now(timezone.utc)

        def one(e: str) -> list[dict]:
            ch = yf.Ticker(ysym).option_chain(e)
            T = max((datetime.strptime(e, "%Y-%m-%d").replace(hour=21, tzinfo=timezone.utc) - now).total_seconds() / 86400, 0) / 365
            calls, puts = ch.calls.to_dict("records"), ch.puts.to_dict("records")
            s_eq = implied_forward(calls, puts, spot, T) * math.exp(-RATE * T)
            return [row(o, e, is_call, s_eq, T) for rows_, is_call in ((calls, True), (puts, False)) for o in rows_]

        with ThreadPoolExecutor(4) as ex:
            rows = [r for part in ex.map(one, exps) for r in part if r["strike"]]
        if not rows:
            raise SourceError(f"Yahoo : chaîne vide pour « {symbol} »")
        return {"symbol": symbol, "underlying": spot, "iv30": iv30(rows, spot, today), "bid": None, "ask": None,
                "timestamp": now.isoformat(timespec="seconds"), "today": today.isoformat(), "options": rows,
                "expiries_loaded": len(exps), "expiries_total": len(dates)}

    def chain(self, symbol: str) -> dict:
        """`_fetch` borné à TIMEOUT secondes : yfinance n'a pas de délai global sur plusieurs requêtes."""
        ex = ThreadPoolExecutor(max_workers=1)
        fut = ex.submit(self._fetch, symbol)
        try:
            return fut.result(timeout=TIMEOUT)
        except FutureTimeout:
            raise RuntimeError(f"Yahoo n'a pas répondu en {TIMEOUT:.0f} s pour « {symbol} » (lenteur ou limite de requêtes)")
        finally:
            ex.shutdown(wait=False)
