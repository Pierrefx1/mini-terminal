"""Mesures de performance et de risque (fonctions pures).

Conventions
- Rendement quotidien : r = (V_fin + sorties) / (V_veille + entrées) - 1
  (entrées investies en début de journée, sorties prélevées en fin de journée).
- TWR : produit des (1 + r) quotidiens ; neutralise l'effet des flux.
- MWR : taux de rendement interne (XIRR, base 365 jours) des flux réels.
- Annualisation des mesures de risque : 252 séances.
"""
import math
from datetime import date

import numpy as np

ANN = 252


def daily_returns(values: list[float], inflows: list[float], outflows: list[float]) -> list[float | None]:
    """None quand aucun capital n'est investi ce jour-là."""
    out: list[float | None] = []
    prev = 0.0
    for v, i, o in zip(values, inflows, outflows):
        basis = prev + i
        out.append((v + o) / basis - 1 if basis > 1e-9 else None)
        prev = v
    return out


def chain(returns) -> float:
    x = 1.0
    for r in returns:
        if r is not None:
            x *= 1 + r
    return x - 1


def index_series(returns, base: float = 100.0) -> list[float]:
    out, x = [], base
    for r in returns:
        if r is not None:
            x *= 1 + r
        out.append(x)
    return out


def xirr(flows: list[tuple[str, float]]) -> float | None:
    """Taux annuel r tel que somme(montant / (1+r)^(jours/365)) = 0.

    Point de vue de l'investisseur : apports négatifs, retraits et valeur finale positifs.
    """
    flows = [(date.fromisoformat(d), a) for d, a in flows if a]
    if not flows or not (any(a > 0 for _, a in flows) and any(a < 0 for _, a in flows)):
        return None
    t0 = min(d for d, _ in flows)
    pts = [((d - t0).days / 365.0, a) for d, a in flows]

    def npv(r):
        return sum(a / (1 + r) ** t for t, a in pts)
    lo, hi = -0.999999, 10.0
    flo, fhi = npv(lo), npv(hi)
    while flo * fhi > 0 and hi < 1e9:
        hi *= 10
        fhi = npv(hi)
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        fm = npv(mid)
        if flo * fm <= 0:
            hi = mid
        else:
            lo, flo = mid, fm
        if hi - lo < 1e-12:
            break
    return (lo + hi) / 2


def deannualize(rate: float, days: int) -> float:
    """Rendement sur la période correspondant à un taux annuel."""
    return (1 + rate) ** (days / 365.0) - 1


def max_drawdown(index: list[float]) -> float:
    peak, mdd = -math.inf, 0.0
    for x in index:
        peak = max(peak, x)
        mdd = min(mdd, x / peak - 1)
    return mdd


def risk(rp, rb, rf) -> dict:
    """rp, rb, rf : rendements quotidiens alignés (portefeuille, benchmark, sans risque)."""
    rp, rb, rf = (np.asarray(x, dtype=float) for x in (rp, rb, rf))
    n = len(rp)
    if n < 20:
        return {"n": n}
    ep, eb, act = rp - rf, rb - rf, rp - rb
    var_b = eb.var(ddof=1)
    beta = float(np.cov(ep, eb, ddof=1)[0, 1] / var_b) if var_b > 0 else None
    alpha = float((ep.mean() - beta * eb.mean()) * ANN) if beta is not None else None
    sd = rp.std(ddof=1)
    downside = math.sqrt(float(np.mean(np.minimum(ep, 0) ** 2)))
    te = act.std(ddof=1)
    return {
        "n": n,
        "beta": beta,
        "alpha": alpha,                                   # alpha de Jensen annualisé
        "volatility": float(sd * math.sqrt(ANN)),
        "benchmark_volatility": float(rb.std(ddof=1) * math.sqrt(ANN)),
        "sharpe": float(ep.mean() / sd * math.sqrt(ANN)) if sd > 0 else None,
        "sortino": float(ep.mean() / downside * math.sqrt(ANN)) if downside > 0 else None,
        "tracking_error": float(te * math.sqrt(ANN)),
        "information_ratio": float(act.mean() / te * math.sqrt(ANN)) if te > 0 else None,
        "correlation": float(np.corrcoef(rp, rb)[0, 1]) if sd > 0 and rb.std() > 0 else None,
        "max_drawdown": max_drawdown(index_series(list(rp))),
        "risk_free_avg": float(rf.mean() * ANN),
    }


def unadjust_closes(closes: list[tuple[str, float]], splits: list[tuple[str, float]]) -> list[tuple[str, float]]:
    """Rétablit les cours historiques réels à partir de cours ajustés des divisions.

    Yahoo divise les cours antérieurs à un split par son ratio ; on les remultiplie
    pour valoriser les quantités réellement détenues à chaque date.
    """
    out = []
    for d, c in closes:
        f = 1.0
        for sd, ratio in splits:
            if sd > d:
                f *= ratio
        out.append((d, c * f))
    return out
