"""Portfolio Management et Risk Management : analyse d'un portefeuille défini par l'utilisateur (aucune donnée stockée côté serveur)."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import risk
from ..cache import HISTORICAL, cached
from ..providers.registry import prices
from . import screener

router = APIRouter(prefix="/api/portfolio", tags=["portefeuille et risque"])

SUFFIX_COUNTRY = {".PA": "France", ".DE": "Allemagne", ".L": "Royaume-Uni", ".AS": "Pays-Bas", ".BR": "Belgique", ".MC": "Espagne", ".MI": "Italie",
                  ".SW": "Suisse", ".T": "Japon", ".HK": "Hong Kong", ".TO": "Canada", ".AX": "Australie", ".ST": "Suède", ".CO": "Danemark"}
FACTORS = [("SPY", "Actions US"), ("TLT", "Obligations US 20 ans et +"), ("UUP", "Dollar"), ("GLD", "Or"), ("USO", "Pétrole")]
FACTOR_SCENARIOS = [
    ("Actions −20 %", {"SPY": -0.20}),
    ("Taux longs +100 pb (TLT ≈ −16 %)", {"TLT": -0.16}),
    ("Dollar +5 %", {"UUP": 0.05}),
    ("Pétrole −30 %", {"USO": -0.30}),
    ("Or +10 %", {"GLD": 0.10}),
    ("Stagflation : actions −15 %, TLT −10 %, pétrole +30 %, or +10 %", {"SPY": -0.15, "TLT": -0.10, "USO": 0.30, "GLD": 0.10}),
    ("Fuite vers la qualité : actions −10 %, TLT +8 %, dollar +3 %, or +5 %", {"SPY": -0.10, "TLT": 0.08, "UUP": 0.03, "GLD": 0.05}),
]
HISTORICAL_SCENARIOS = [("Krach du Covid", "2020-02-19", "2020-03-23"), ("Choc de taux 2022", "2022-01-03", "2022-10-12"),
                        ("Faillite de SVB", "2023-03-08", "2023-03-13"), ("Débouclage du carry trade yen", "2024-07-31", "2024-08-05"),
                        ("Annonce des droits de douane US", "2025-04-02", "2025-04-08")]


class Holding(BaseModel):
    symbol: str
    weight: float = Field(gt=0)


class Request(BaseModel):
    holdings: list[Holding] = Field(min_length=1, max_length=40)
    benchmark: str = "URTH"
    base: str = "USD"
    years: int = Field(3, ge=1, le=10)
    rebalance: int = Field(0, ge=0, le=252)
    rf: float = 0.04
    capital: float = 1_000_000


def _daily(symbol: str) -> dict:
    env = cached(f"hist:{symbol}:1d:10y", 6 * 3600, prices.name, lambda: prices.history(symbol, "1d", "10y"))
    h = env["data"]
    return {"currency": h.get("currency"), "type": h.get("type"), "name": h.get("name"),
            "series": {datetime.fromtimestamp(c["time"], timezone.utc).date().isoformat(): c.get("adjclose") or c["close"] for c in h["candles"]}}


def _fx_series(ccy: str, base: str) -> dict[str, float] | None:
    """Cours pour convertir `ccy` en `base` (1 unité de ccy = x base)."""
    if not ccy or ccy == base:
        return None
    if ccy in ("GBp", "GBX"):
        s = _fx_series("GBP", base)
        return {d: v / 100 for d, v in (s or {}).items()} if s else {"*": 0.01}
    return _daily(f"{ccy}{base}=X")["series"]


def _align(series: list[dict[str, float]]) -> tuple[list[str], np.ndarray]:
    start = max(min(s) for s in series)
    dates = sorted({d for s in series for d in s if d >= start})
    out = np.full((len(dates), len(series)), np.nan)
    for j, s in enumerate(series):
        last = None
        for i, d in enumerate(dates):
            last = s.get(d, last)
            out[i, j] = last if last is not None else np.nan
    keep = ~np.isnan(out).any(axis=1)
    return [d for d, k in zip(dates, keep) if k], out[keep]


def _in_base(sym: str, base: str) -> tuple[dict[str, float], dict]:
    d = _daily(sym)
    fx = _fx_series(d["currency"], base)
    s = d["series"]
    if fx == {"*": 0.01}:
        s = {k: v * 0.01 for k, v in s.items()}
    elif fx:
        dates, arr = _align([s, fx])
        s = {k: a * b for k, (a, b) in zip(dates, arr)}
    return s, d


def _country(sym: str, meta: dict | None) -> str:
    if meta and meta.get("country"):
        return meta["country"]
    return next((c for suf, c in SUFFIX_COUNTRY.items() if sym.upper().endswith(suf)), "États-Unis" if "." not in sym and "=" not in sym and "^" not in sym else "Autre")


@router.post("/analyze")
def analyze(req: Request):
    syms = [h.symbol.upper() for h in req.holdings]
    if len(set(syms)) != len(syms):
        raise HTTPException(400, "Symbole en double dans le portefeuille")
    w_target = np.array([h.weight for h in req.holdings], dtype=float)
    w_target = w_target / w_target.sum()
    try:
        with ThreadPoolExecutor(6) as ex:
            loaded = list(ex.map(lambda s: _in_base(s, req.base), syms + [req.benchmark] + [f for f, _ in FACTORS]))
    except Exception as e:
        raise HTTPException(502, detail={"source": prices.name, "error": f"Historique indisponible : {getattr(e, 'detail', e)}"})
    full_dates, full = _align([s for s, _ in loaded[:len(syms)]] + [loaded[len(syms)][0]])
    if len(full_dates) < 60:
        raise HTTPException(400, "Historique commun trop court (moins de 60 séances) : vérifier les symboles")
    cut = next((i for i, d in enumerate(full_dates) if d >= f"{int(full_dates[-1][:4]) - req.years}{full_dates[-1][4:]}"), 0)
    dates, P = full_dates[cut:], full[cut:]
    assets, bench = P[:, :-1], P[:, -1]

    values = risk.portfolio_values(assets, w_target, req.rebalance)
    bvals = bench / bench[0]
    r, rb = risk.returns(values), risk.returns(bvals)
    a_rets = assets[1:] / assets[:-1] - 1
    drift = w_target * assets[-1] / assets[0]
    cur_w = drift / drift.sum() if not req.rebalance else w_target

    # facteurs : bêtas sur les deux dernières années
    fdates, F = _align([s for s, _ in loaded[len(syms) + 1:]])
    pv = dict(zip(dates, values))
    common = [i for i, d in enumerate(fdates) if d in pv][-504:]
    fac = {}
    if len(common) > 60:
        fr = F[common][1:] / F[common][:-1] - 1
        pr = np.array([pv[fdates[i]] for i in common])
        betas = risk.factor_betas(pr[1:] / pr[:-1] - 1, fr)
        fac = {f: float(b) for (f, _), b in zip(FACTORS, betas)}

    # scénarios historiques, sur tout l'historique disponible
    hist = []
    full_v = risk.portfolio_values(full[:, :-1], w_target, req.rebalance)
    idx = {d: i for i, d in enumerate(full_dates)}
    for name, d0, d1 in HISTORICAL_SCENARIOS:
        i0 = next((idx[d] for d in full_dates if d >= d0), None)
        i1 = max((idx[d] for d in full_dates if d <= d1), default=None)
        if i0 is None or i1 is None or i1 <= i0 or full_dates[0] > d0:
            hist.append({"name": name, "start": d0, "end": d1, "pnl_pct": None, "note": "historique commun insuffisant"})
        else:
            hist.append({"name": name, "start": d0, "end": d1, "pnl_pct": (full_v[i1] / full_v[i0] - 1) * 100,
                         "bench_pct": (full[i1, -1] / full[i0, -1] - 1) * 100})

    mc = risk.monte_carlo(a_rets[-504:], cur_w, horizon=10, paths=10_000)
    with ThreadPoolExecutor(6) as ex:
        meta = list(ex.map(lambda i: screener.classify(syms[i], loaded[i][1].get("type")), range(len(syms))))
    lines = []
    for i, s in enumerate(syms):
        m, d = meta[i], loaded[i][1]
        lines.append({"symbol": s, "name": d.get("name"), "currency": d.get("currency"), "type": d.get("type"),
                      "sector": (m or {}).get("sector") or {"ETF": "ETF / fonds", "INDEX": "Indice", "CURRENCY": "Devise", "FUTURE": "Matière première",
                                                            "CRYPTOCURRENCY": "Crypto"}.get(d.get("type"), "Non classé"),
                      "country": _country(s, m), "target": float(w_target[i]), "current": float(cur_w[i]),
                      "return_pct": float((assets[-1, i] / assets[0, i] - 1) * 100),
                      "contribution_pct": float(risk.contributions(assets, w_target)[i] * 100) if not req.rebalance else None,
                      "vol_pct": float(a_rets[:, i].std(ddof=1) * np.sqrt(252) * 100)})
    rc = risk.risk_contributions(a_rets[-252:], cur_w)
    for i, l in enumerate(lines):
        l["risk_contribution_pct"] = float(rc[i] * 100)

    def expo(key):
        out: dict[str, float] = {}
        for l in lines:
            out[l[key]] = out.get(l[key], 0) + l["current"] * 100
        return sorted(({"name": k, "weight": v} for k, v in out.items()), key=lambda x: -x["weight"])

    last_year = a_rets[-252:]
    corr = np.corrcoef(last_year, rowvar=False) if len(syms) > 1 else np.array([[1.0]])
    step = max(1, len(dates) // 400)
    return {
        "data": {
            "base": req.base, "benchmark": req.benchmark, "start": dates[0], "end": dates[-1], "capital": req.capital,
            "series": [{"date": d, "value": float(v * 100), "bench": float(b * 100)} for d, v, b in list(zip(dates, values, bvals))[::step] + [(dates[-1], values[-1], bvals[-1])]],
            "performance": {"total_pct": float((values[-1] - 1) * 100), "bench_total_pct": float((bvals[-1] - 1) * 100),
                            "pnl": float((values[-1] - 1) * req.capital), **risk.ratios(r, req.rf, rb), "max_drawdown": risk.max_drawdown(values),
                            "bench_max_drawdown": risk.max_drawdown(bvals)},
            "var": {f"{m}_{int(l * 100)}_{h}": v for l in (0.95, 0.99) for h in (1, 10)
                    for m, v in (("hist", risk.var_historical(r[-504:], l, h)), ("param", risk.var_parametric(r[-504:], l, h)))}
                   | {f"es_hist_{int(l * 100)}_1": risk.es_historical(r[-504:], l) for l in (0.95, 0.99)}
                   | {f"es_param_{int(l * 100)}_1": risk.es_parametric(r[-504:], l) for l in (0.95, 0.99)}
                   | {"mc_95_10": float(-np.quantile(mc, 0.05)), "mc_99_10": float(-np.quantile(mc, 0.01)), "mc_es_99_10": float(-mc[mc <= np.quantile(mc, 0.01)].mean())},
            "mc_hist": np.histogram(mc * 100, bins=40)[0].tolist(), "mc_edges": np.histogram(mc * 100, bins=40)[1].tolist(),
            "lines": lines, "sectors": expo("sector"), "countries": expo("country"), "currencies": expo("currency"),
            "correlation": {"symbols": syms, "matrix": np.round(corr, 3).tolist()},
            "factors": [{"symbol": f, "name": n, "beta": fac.get(f)} for f, n in FACTORS],
            "factor_scenarios": [{"name": n, "pnl_pct": sum(fac.get(k, 0) * v for k, v in shocks.items()) * 100 if fac else None} for n, shocks in FACTOR_SCENARIOS],
            "historical_scenarios": hist,
        },
        "source": f"{prices.name} (cours ajustés des dividendes), calculs du terminal", "status": HISTORICAL,
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "stale": False, "error": None,
    }
