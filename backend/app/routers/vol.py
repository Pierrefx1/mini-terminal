"""VOL : surface de volatilité implicite (moteur `vol_surface`, chaîne Yahoo Finance via yfinance),
historique quotidien des métriques à 30 jours et comparaison avec la volatilité réalisée."""
import logging
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import numpy as np
from fastapi import APIRouter, Query

from .. import config, db  # noqa: F401  (config charge .env)
from .. import vol_surface as vs
from ..cache import DELAYED, HISTORICAL, SourceError, cached
from ..providers.registry import prices

log = logging.getLogger("market-terminal")
router = APIRouter(prefix="/api", tags=["vol"])

SOURCE = "Yahoo Finance via yfinance (différé)"
TTL = 300  # 5 minutes par ticker et jeu de paramètres : yfinance est lent et limité en requêtes
NY = ZoneInfo("America/New_York")
# Sous-jacents capturés chaque soir de séance, en plus de ceux consultés dans VOL
WATCH = [s.strip().upper() for s in os.getenv("VOL_WATCH", "SPY,QQQ,IWM").split(",") if s.strip()]


def _is_default(cfg: vs.Config) -> bool:
    return cfg == vs.Config()


def record_snapshot(d: dict) -> None:
    """Une ligne par sous-jacent et par séance (date de New York) ; la dernière surface du jour l'emporte."""
    cm30, cm90 = d.get("cm30") or {}, d.get("cm90") or {}
    if cm30.get("atm_vol") is None:
        return
    with db.conn() as c:
        c.execute("INSERT OR REPLACE INTO vol_history VALUES (?,?,?,?,?,?,?,?,?,?)",
                  (d["ticker"], datetime.now(NY).date().isoformat(), d["spot"], cm30.get("atm_vol"), cm30.get("skew_90_110"),
                   cm30.get("fly_90_110"), cm90.get("atm_vol"), cm90.get("skew_90_110"), d["n_points"],
                   datetime.now().astimezone().isoformat(timespec="seconds")))


def get_surface(sym: str, cfg: vs.Config, force: bool = False) -> dict:
    def fetch():
        try:
            d = vs.compute(sym, cfg)
        except vs.VolSurfaceError as e:  # message destiné à l'utilisateur, affiché tel quel
            raise SourceError(str(e)) from e
        if _is_default(cfg):  # l'historique n'a de sens qu'avec des paramètres constants
            record_snapshot(d)
        return d

    key = f"vol:{sym}:{cfg.rate:g}:{cfg.min_open_interest}:{cfg.max_rel_spread:g}:{cfg.k_range:g}"
    return cached(key, TTL, SOURCE, fetch, force=force, status=DELAYED)


@router.get("/vol/surface")
def surface(
    symbol: str = Query("SPY", min_length=1, max_length=15),
    rate: float = Query(0.04, ge=-0.05, le=0.25),
    min_open_interest: int = Query(10, ge=0, le=100_000),
    max_rel_spread: float = Query(0.35, gt=0, le=2),
    k_range: float = Query(0.35, gt=0.02, le=1.5),
    force: bool = False,
):
    cfg = vs.Config(rate=rate, min_open_interest=min_open_interest, max_rel_spread=max_rel_spread, k_range=k_range)
    return get_surface(symbol.strip().upper(), cfg, force)


def _rv(symbol: str) -> dict:
    """Vol réalisée 20 et 60 séances sur 2 ans (Yahoo, clôtures ajustées si disponibles)."""
    def fetch():
        candles = prices.history(symbol, "1d", "2y")["candles"]
        if len(candles) < 70:
            raise SourceError(f"{symbol} : historique de cours insuffisant pour la vol réalisée")
        closes = np.array([c.get("adjclose") or c["close"] for c in candles], float)
        dates = [datetime.fromtimestamp(c["time"], NY).date().isoformat() for c in candles]
        rv20, rv60 = vs.realized_vol(closes, 20), vs.realized_vol(closes, 60)
        nz = lambda a: [None if not np.isfinite(x) else round(float(x), 6) for x in a]
        return {"dates": dates, "rv20": nz(rv20), "rv60": nz(rv60)}
    return cached(f"rv:{symbol.upper()}", 3600, prices.name, fetch, status=HISTORICAL)


@router.get("/vol/history")
def history(symbol: str = Query("SPY", min_length=1, max_length=15)):
    """Historique des métriques 30 j enregistrées + vol réalisée, et positionnement de la vol implicite actuelle."""
    sym = symbol.strip().upper()
    rv_env = _rv(sym)
    rv = rv_env["data"]
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT date, spot, atm30, skew30, fly30, atm90, skew90, n_points FROM vol_history "
                                           "WHERE ticker=? ORDER BY date", (sym,))]
    rv20 = np.array([x if x is not None else np.nan for x in rv["rv20"]], float)
    rv60 = np.array([x if x is not None else np.nan for x in rv["rv60"]], float)
    last = rows[-1] if rows else None
    iv = last["atm30"] if last else None
    cur20 = next((float(x) for x in rv20[::-1] if np.isfinite(x)), None)
    cur60 = next((float(x) for x in rv60[::-1] if np.isfinite(x)), None)
    hist = lambda k: np.array([r[k] for r in rows if r[k] is not None], float)
    stats = {
        "iv30": iv, "iv30_date": last["date"] if last else None, "rv20": cur20, "rv60": cur60,
        "spread_20": iv - cur20 if iv is not None and cur20 is not None else None,
        "spread_60": iv - cur60 if iv is not None and cur60 is not None else None,
        # où se situe la vol implicite actuelle dans la distribution de la vol réalisée 20 j sur 2 ans
        "iv30_pct_vs_rv20": vs.percentile_rank(rv20, iv) if iv is not None else None,
        "rv20_pct": vs.percentile_rank(rv20, cur20) if cur20 is not None else None,
        # rang dans son propre historique (significatif à partir d'une vingtaine de séances enregistrées)
        "iv30_pct_own": vs.percentile_rank(hist("atm30"), iv) if len(rows) >= 20 and iv is not None else None,
        "skew30_pct_own": vs.percentile_rank(hist("skew30"), last["skew30"]) if len(rows) >= 20 and last and last["skew30"] is not None else None,
        "n_days": len(rows),
    }
    return {**rv_env, "source": f"{rv_env['source'].replace(' (différé)', '')} + historique local", "data": {"symbol": sym, "rv": rv, "iv": rows, "stats": stats}}


def snapshot_watchlist() -> None:
    """Tâche du soir (séance US) : capture la surface des sous-jacents suivis pour alimenter l'historique."""
    if datetime.now(NY).weekday() >= 5:
        return
    with db.conn() as c:
        seen = [r["ticker"] for r in c.execute("SELECT DISTINCT ticker FROM vol_history")]
    for sym in dict.fromkeys(WATCH + seen):
        try:
            get_surface(sym, vs.Config(), force=True)
        except Exception as e:  # un sous-jacent en échec ne bloque pas les autres
            log.warning("capture VOL %s en échec : %s", sym, e)
