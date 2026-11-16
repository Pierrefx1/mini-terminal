"""Heatmap et screener actions.

Deux niveaux de rafraîchissement pour ménager la source :
- performances : appels groupés (20 symboles), cache 15 min ;
- détails (volume moyen, rendement du dividende) : un appel par valeur, une fois par jour, en tâche de fond.
Capitalisation et PER ne sont pas disponibles gratuitement : la taille des tuiles utilise le poids dans
l'indice (S&P 500) ou le volume échangé.
"""
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from ..cache import _read, _envelope, cached
from ..providers import universe
from ..providers.registry import fx, prices

router = APIRouter(prefix="/api/screener", tags=["actions"])
_progress: dict[str, dict] = {}
_lock = threading.Lock()


def members(u: str) -> dict:
    label, fn, source = universe.UNIVERSES[u]
    return cached(f"universe:{u}", 7 * 86400, source, fn)


def _perf(c: list[float], t: list[int]) -> dict:
    last = c[-1]
    back = lambda n: (last / c[-1 - n] - 1) * 100 if len(c) > n else None
    year = datetime.fromtimestamp(t[-1], timezone.utc).year
    prev_year = [x for x, ts in zip(c, t) if datetime.fromtimestamp(ts, timezone.utc).year < year]
    return {"price": last, "d1": back(1), "w1": back(5), "m1": back(21), "ytd": (last / prev_year[-1] - 1) * 100 if prev_year else None,
            "y1": (last / c[0] - 1) * 100 if len(c) > 200 else None}


def _perfs(u: str) -> dict:
    syms = [m["symbol"] for m in members(u)["data"]]
    out, errors = {}, 0
    for i in range(0, len(syms), 20):
        try:
            for s, v in prices.spark(syms[i:i + 20]).items():
                out[s] = _perf(v["c"], v["t"])
        except Exception:
            errors += 1
            if errors > 3 and not out:
                raise
        time.sleep(0.15)
    if not out:
        raise RuntimeError("aucun cours reçu")
    return out


def _details_job(u: str) -> None:
    """Volume moyen sur un mois et dividendes sur douze mois, valeur par valeur (une fois par jour)."""
    syms = [m["symbol"] for m in members(u)["data"]]
    _progress[u] = {"done": 0, "total": len(syms), "running": True, "error": None}
    out, fails = {}, 0
    try:
        for s in syms:
            try:
                h = prices.history(s, "1d", "1y", events=True)
                last = h["candles"][-22:]
                px = h["candles"][-1]["close"]
                scale = 0.01 if h["currency"] == "GBp" else 1.0
                cut = time.time() - 365 * 86400
                div = sum(d["amount"] for d in h.get("dividends", []) if d["time"] >= cut)
                out[s] = {"currency": "GBP" if h["currency"] == "GBp" else h["currency"],
                          "avg_volume": sum(c["volume"] for c in last) / len(last),
                          "turnover": sum(c["volume"] * c["close"] for c in last) / len(last) * scale,
                          "div_yield": div / px * 100 if px else None}
                fails = 0
            except Exception as e:
                fails += 1
                if fails >= 15:  # la source refuse : on s'arrête plutôt que d'insister
                    _progress[u]["error"] = f"interrompu après 15 échecs consécutifs ({e})"
                    break
            _progress[u]["done"] += 1
            time.sleep(0.12)
        if out:
            cached(f"screener:details:{u}", 0, prices.name, lambda: out, force=True)
    finally:
        _progress[u]["running"] = False


def _details(u: str) -> dict | None:
    row = _read(f"screener:details:{u}")
    env = _envelope(row) if row else None
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(env["fetched_at"])).total_seconds() if env else None
    with _lock:
        if (age is None or age > 86400) and not _progress.get(u, {}).get("running"):
            _progress[u] = {"done": 0, "total": 0, "running": True, "error": None}
            threading.Thread(target=_details_job, args=(u,), daemon=True).start()
    return env


def _eur_rates() -> dict:
    out = {"EUR": 1.0}
    for c in ("USD", "GBP", "CHF", "SEK", "DKK", "NOK", "PLN"):
        try:
            out[c] = cached(f"fx:last:{c}", 12 * 3600, fx.name, lambda c=c: fx.rates(c, "2026-01-01")[-1])["data"][1]
        except Exception:
            pass
    return out


@router.get("")
def screener(universe_id: str = "sp500"):
    if universe_id not in universe.UNIVERSES:
        raise HTTPException(404, "Univers inconnu")
    mem = members(universe_id)
    perf = cached(f"screener:perf:{universe_id}", 900, prices.name, lambda: _perfs(universe_id))
    det = _details(universe_id)
    rates = _eur_rates()
    rows = []
    for m in mem["data"]:
        p = perf["data"].get(m["symbol"])
        d = (det["data"].get(m["symbol"]) if det else None) or {}
        r = rates.get(d.get("currency"))
        rows.append({**m, **(p or {"price": None}), "currency": d.get("currency"), "avg_volume": d.get("avg_volume"), "div_yield": d.get("div_yield"),
                     "turnover_eur": d["turnover"] / r if d.get("turnover") and r else None})
    return {"data": {"label": universe.UNIVERSES[universe_id][0], "rows": rows, "priced": sum(1 for r in rows if r["price"] is not None),
                     "details": {"fetched_at": det["fetched_at"] if det else None, **_progress.get(universe_id, {})},
                     "members_source": mem["source"], "members_fetched_at": mem["fetched_at"]},
            "source": perf["source"], "fetched_at": perf["fetched_at"], "stale": perf["stale"] or mem["stale"], "error": perf["error"] or mem["error"]}


def lookup(symbol: str) -> dict | None:
    """Secteur et pays d'une valeur si elle appartient à un univers déjà chargé (sans appel réseau)."""
    for u in universe.UNIVERSES:
        row = _read(f"universe:{u}")
        if row:
            for m in _envelope(row)["data"]:
                if m["symbol"] == symbol:
                    return m
    return None
