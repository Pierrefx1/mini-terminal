"""Tradier : chaînes d'options américaines, grecques et volatilité implicite (calculées par ORATS, mises à jour toutes les heures).

Remplace CBOE, qui refuse désormais les appels automatisés (403). Clé gratuite : compte développeur Tradier
(environnement « sandbox », cours différés de 15 min) ou compte de courtage (« production », temps réel).
Configuration : TRADIER_API_KEY et TRADIER_ENV (sandbox par défaut) dans .env.

Points d'accès utilisés (en-tête « Authorization: Bearer <clé> », réponses JSON) :
  /v1/markets/options/expirations?symbol=…&includeAllRoots=true   -> {"expirations": {"date": [...]}}
  /v1/markets/options/chains?symbol=…&expiration=…&greeks=true     -> {"options": {"option": [...]}}
  /v1/markets/quotes?symbols=…                                     -> {"quotes": {"quote": {...}}}
Tradier renvoie un objet seul au lieu d'une liste quand il n'y a qu'un élément, et null quand il n'y en a aucun :
`_items` normalise ces trois cas. Fonctions de conversion pures, testées dans tests/test_tradier.py.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date

import httpx

from .. import config
from ..cache import SourceError
from .http import client

HOSTS = {"sandbox": "https://sandbox.tradier.com/v1", "production": "https://api.tradier.com/v1"}
# indices : symbole Tradier sans préfixe
INDEX = {"^GSPC": "SPX", "^SPX": "SPX", "^NDX": "NDX", "^RUT": "RUT", "^VIX": "VIX", "^DJI": "DJX", "^XSP": "XSP"}
MAX_EXPIRIES = 18      # échéances chargées : toutes les proches, puis espacées (limite d'appels de l'API)
NEAR_DAYS = 45         # en deçà, toutes les échéances sont gardées
MAX_DAYS = 760


def tradier_symbol(symbol: str) -> str:
    return INDEX.get(symbol.upper(), symbol.upper().lstrip("^"))


def _items(node, key: str) -> list:
    """{"option": [...]} | {"option": {...}} | null -> liste."""
    if not isinstance(node, dict):
        return []
    v = node.get(key)
    return v if isinstance(v, list) else [v] if isinstance(v, dict) or isinstance(v, str) else []


def pick_expiries(dates: list[str], today: date, n: int = MAX_EXPIRIES) -> list[str]:
    """Échéances à charger : toutes celles des NEAR_DAYS prochains jours (hebdomadaires comprises), puis un
    échantillon régulier des suivantes jusqu'à MAX_DAYS, pour couvrir la surface sans épuiser le quota d'appels."""
    future = sorted(d for d in dates if 0 <= (date.fromisoformat(d) - today).days <= MAX_DAYS)
    near = [d for d in future if (date.fromisoformat(d) - today).days <= NEAR_DAYS]
    far = [d for d in future if d not in near]
    near = near[: max(1, n // 2)]
    room = n - len(near)
    if len(far) > room > 0:  # échantillon régulier, première et dernière comprises
        far = [far[0]] if room == 1 else [far[round(i * (len(far) - 1) / (room - 1))] for i in range(room)]
    elif room <= 0:
        far = []
    return sorted(set(near + far))


def convert(o: dict) -> dict | None:
    """Option Tradier -> ligne de chaîne du terminal (même format que l'ancien fournisseur CBOE)."""
    typ = o.get("option_type")
    if typ not in ("call", "put") or o.get("strike") is None or not o.get("expiration_date"):
        return None
    g = o.get("greeks") or {}
    iv = g.get("mid_iv") or g.get("smv_vol") or None  # en fraction (0,25 = 25 %)
    return {"expiry": o["expiration_date"], "type": typ, "strike": float(o["strike"]),
            "bid": o.get("bid"), "ask": o.get("ask"), "last": o.get("last"), "iv": iv,
            "delta": g.get("delta"), "gamma": g.get("gamma"), "vega": g.get("vega"), "theta": g.get("theta"), "rho": g.get("rho"),
            "theo": None, "volume": o.get("volume"), "oi": o.get("open_interest"), "change": o.get("change"),
            "greeks_at": g.get("updated_at")}


def iv30(rows: list[dict], spot: float, today: date) -> float | None:
    """Volatilité implicite à la monnaie interpolée à 30 jours (en %), à défaut de l'indice VIX-like fourni par CBOE."""
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
    below = [a for a in atm if a[0] <= 30]
    above = [a for a in atm if a[0] >= 30]
    if below and above:
        (d1, v1), (d2, v2) = below[-1], above[0]
        v = v1 if d1 == d2 else v1 + (v2 - v1) * (30 - d1) / (d2 - d1)
    else:
        v = (below or above)[-1 if below else 0][1]
    return round(v * 100, 2)


class Tradier:
    name = "Tradier (options, grecques ORATS)"

    def __init__(self, key: str | None = None, env: str | None = None):
        self.key = key if key is not None else config.TRADIER_API_KEY
        self.env = (env or config.TRADIER_ENV or "sandbox").lower()
        self.base = HOSTS.get(self.env, HOSTS["sandbox"])

    def _get(self, path: str, **params) -> dict:
        if not self.key:
            raise SourceError("Tradier : clé absente, renseigner TRADIER_API_KEY dans .env (compte développeur gratuit)")
        try:
            r = client.get(f"{self.base}{path}", params=params, headers={"Authorization": f"Bearer {self.key}", "Accept": "application/json"})
        except httpx.TransportError as e:
            raise RuntimeError(f"Tradier injoignable : {e}") from e
        if r.status_code == 401:
            raise RuntimeError(f"Tradier : clé refusée (401). Une clé sandbox ne marche qu'avec TRADIER_ENV=sandbox, une clé de compte qu'avec production ; environnement actuel : {self.env}")
        if r.status_code == 429:
            raise RuntimeError("Tradier : quota d'appels atteint (429), nouvel essai dans une minute")
        r.raise_for_status()
        return r.json()

    def quote(self, symbol: str) -> dict:
        q = _items((self._get("/markets/quotes", symbols=tradier_symbol(symbol)) or {}).get("quotes"), "quote")
        if not q or q[0].get("last") is None and q[0].get("bid") is None:
            raise SourceError(f"Tradier : symbole « {symbol} » inconnu")
        q = q[0]
        return {"symbol": symbol, "current_price": q.get("last") or q.get("close") or q.get("prevclose"), "bid": q.get("bid"), "ask": q.get("ask"),
                "bid_size": q.get("bidsize"), "ask_size": q.get("asksize"), "volume": q.get("volume"), "prev_day_close": q.get("prevclose"),
                "last_trade_time": q.get("trade_date")}

    def chain(self, symbol: str) -> dict:
        sym, today = tradier_symbol(symbol), date.today()
        q = self.quote(symbol)
        dates = _items((self._get("/markets/options/expirations", symbol=sym, includeAllRoots="true") or {}).get("expirations"), "date")
        exps = pick_expiries([str(d) for d in dates], today)
        if not exps:
            raise SourceError(f"Tradier : pas d'options cotées pour « {symbol} » (seules les options américaines sont couvertes)")

        def one(e: str) -> list[dict]:
            data = self._get("/markets/options/chains", symbol=sym, expiration=e, greeks="true") or {}
            return [c for o in _items(data.get("options"), "option") if (c := convert(o))]

        with ThreadPoolExecutor(4) as ex:
            rows = [r for part in ex.map(one, exps) for r in part]
        if not rows:
            raise SourceError(f"Tradier : chaîne vide pour « {symbol} »")
        spot = q["current_price"]
        stamp = max((r["greeks_at"] for r in rows if r.get("greeks_at")), default=None)
        return {"symbol": symbol, "underlying": spot, "iv30": iv30(rows, spot, today) if spot else None, "bid": q["bid"], "ask": q["ask"],
                "timestamp": stamp, "today": today.isoformat(), "options": rows,
                "expiries_loaded": len(exps), "expiries_total": len(dates)}
