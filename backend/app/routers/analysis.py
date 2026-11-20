"""Equities (FA, comparables), Derivatives (chaîne d'options, surface de volatilité), Economics (impact des publications)."""
import math
import statistics
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from .. import config, sec
from ..cache import DELAYED, HISTORICAL, SourceError, cached
from ..providers import sec as sec_provider
from ..providers.registry import macro, options, prices
from . import screener

router = APIRouter(prefix="/api", tags=["analyse"])

# ─────────────────────────── Equities : analyse fondamentale ───────────────────────────
INCOME = ["TotalRevenue", "CostOfRevenue", "GrossProfit", "OperatingExpense", "OperatingIncome", "EBITDA", "InterestExpense",
          "PretaxIncome", "TaxProvision", "NetIncome", "DilutedEPS", "DilutedAverageShares", "TaxRateForCalcs"]
BALANCE = ["TotalAssets", "CurrentAssets", "CashCashEquivalentsAndShortTermInvestments", "TotalLiabilitiesNetMinorityInterest",
           "CurrentLiabilities", "TotalDebt", "NetDebt", "StockholdersEquity", "InvestedCapital", "OrdinarySharesNumber"]
CASHFLOW = ["OperatingCashFlow", "CapitalExpenditure", "FreeCashFlow", "CashDividendsPaid", "RepurchaseOfCapitalStock"]
VALUATION = ["MarketCap", "EnterpriseValue", "PeRatio", "ForwardPeRatio", "PbRatio", "PsRatio", "EnterprisesValueEBITDARatio", "EnterprisesValueRevenueRatio"]


def _series(raw: dict, prefix: str, items: list[str]) -> dict[str, list]:
    return {i: raw.get(prefix + i, []) for i in items}


def _table(block: dict[str, list]) -> dict:
    dates = sorted({p["date"] for pts in block.values() for p in pts})
    return {"dates": dates, "rows": {k: [next((p["value"] for p in pts if p["date"] == d), None) for d in dates] for k, pts in block.items()}}


def ratios(inc: dict, bal: dict, cf: dict) -> dict:
    """Ratios de l'exercice le plus récent (valeurs en %, sauf levier en x)."""
    last = lambda t, k: (t["rows"].get(k) or [None])[-1]  # noqa: E731
    prev = lambda t, k: (t["rows"].get(k) or [None, None])[-2] if len(t["rows"].get(k) or []) > 1 else None  # noqa: E731
    rev, ni, op, ebitda, gp = (last(inc, k) for k in ("TotalRevenue", "NetIncome", "OperatingIncome", "EBITDA", "GrossProfit"))
    eq, eq0, ic, ic0 = last(bal, "StockholdersEquity"), prev(bal, "StockholdersEquity"), last(bal, "InvestedCapital"), prev(bal, "InvestedCapital")
    tax = last(inc, "TaxRateForCalcs")
    debt, cash, fcf = last(bal, "TotalDebt"), last(bal, "CashCashEquivalentsAndShortTermInvestments"), last(cf, "FreeCashFlow")
    avg = lambda a, b: (a + b) / 2 if a is not None and b is not None else a  # noqa: E731
    pct = lambda a, b: a / b * 100 if a is not None and b else None  # noqa: E731
    nopat = op * (1 - (tax if tax is not None else 0.21)) if op is not None else None
    rev0 = prev(inc, "TotalRevenue")
    return {"gross_margin": pct(gp, rev), "operating_margin": pct(op, rev), "ebitda_margin": pct(ebitda, rev), "net_margin": pct(ni, rev),
            "roe": pct(ni, avg(eq, eq0)), "roic": pct(nopat, avg(ic, ic0)), "fcf_margin": pct(fcf, rev),
            "revenue_growth": (rev / rev0 - 1) * 100 if rev and rev0 else None,
            "net_debt": debt - cash if debt is not None and cash is not None else None,
            "net_debt_ebitda": (debt - cash) / ebitda if debt is not None and cash is not None and ebitda else None,
            "debt_equity": debt / eq if debt is not None and eq else None, "tax_rate": tax * 100 if tax is not None else None}


def fundamentals(symbol: str) -> dict:
    types = [f"{p}{i}" for p in ("annual", "quarterly") for i in INCOME + BALANCE + CASHFLOW] + [f"quarterly{v}" for v in VALUATION] + ["trailingDilutedEPS", "trailingEBITDA", "trailingTotalRevenue", "trailingNetIncome", "trailingFreeCashFlow"]
    raw = prices.fundamentals(symbol, types)
    if not raw:
        raise SourceError(f"Yahoo : pas d'états financiers publiés pour « {symbol} » (indices, devises et matières n'en ont pas)")
    inc, bal, cf = (_table(_series(raw, "annual", x)) for x in (INCOME, BALANCE, CASHFLOW))
    q = {k: _table(_series(raw, "quarterly", x)) for k, x in (("income", INCOME), ("balance", BALANCE), ("cashflow", CASHFLOW))}
    val = {v: (raw.get(f"quarterly{v}") or [{}])[-1].get("value") for v in VALUATION}
    ttm = {k: (raw.get(f"trailing{k}") or [{}])[-1].get("value") for k in ("DilutedEPS", "EBITDA", "TotalRevenue", "NetIncome", "FreeCashFlow")}
    currency = next((p.get("currency") for pts in raw.values() for p in pts if p.get("currency")), None)
    r = ratios(inc, bal, cf)
    if val.get("MarketCap") and ttm.get("FreeCashFlow"):
        r["fcf_yield"] = ttm["FreeCashFlow"] / val["MarketCap"] * 100
    return {"symbol": symbol, "currency": currency, "annual": {"income": inc, "balance": bal, "cashflow": cf}, "quarterly": q,
            "valuation": val, "valuation_date": next((p["date"] for p in reversed(raw.get("quarterlyMarketCap", []))), None), "ttm": ttm, "ratios": r}


@router.get("/equities/fa")
def fa(symbol: str):
    def fetch():
        out = fundamentals(symbol)
        meta = screener.lookup(symbol)
        out["sector"] = meta.get("sector") if meta else None
        return out
    return cached(f"fa:{symbol.upper()}", 12 * 3600, "Yahoo Finance (états publiés)", fetch, status=HISTORICAL)


def _sec_cik(symbol: str) -> int:
    env = cached("sec:tickers", 7 * 86400, "SEC EDGAR", sec_provider.ticker_map, status=HISTORICAL)
    cik = env["data"].get(symbol) or env["data"].get(symbol.replace(".", "-"))
    if not cik:
        raise SourceError(f"SEC : « {symbol} » ne dépose pas de 10-K (société non américaine, ETF ou indice)")
    return cik


def ratio_history(t: dict) -> dict[str, list]:
    """Ratios par exercice sur l'historique long (mêmes définitions que `ratios`, capitaux moyens sur deux clôtures)."""
    inc, bal, cf = t["income"]["rows"], t["balance"]["rows"], t["cashflow"]["rows"]
    n = len(t["income"]["dates"])
    pct = lambda a, b: a / b * 100 if a is not None and b else None  # noqa: E731
    avg = lambda s, i: (s[i] + s[i - 1]) / 2 if i and s[i] is not None and s[i - 1] is not None else s[i]  # noqa: E731
    out: dict[str, list] = {k: [] for k in ("gross_margin", "operating_margin", "net_margin", "fcf_margin", "roe", "roic", "revenue_growth", "net_debt_ebitda")}
    for i in range(n):
        rev = inc["TotalRevenue"][i]
        tax = inc["TaxRateForCalcs"][i]
        op = inc["OperatingIncome"][i]
        nopat = op * (1 - (tax if tax is not None and 0 <= tax < 0.6 else 0.21)) if op is not None else None
        out["gross_margin"].append(pct(inc["GrossProfit"][i], rev))
        out["operating_margin"].append(pct(op, rev))
        out["net_margin"].append(pct(inc["NetIncome"][i], rev))
        out["fcf_margin"].append(pct(cf["FreeCashFlow"][i], rev))
        out["roe"].append(pct(inc["NetIncome"][i], avg(bal["StockholdersEquity"], i)))
        out["roic"].append(pct(nopat, avg(bal["InvestedCapital"], i)))
        prev = inc["TotalRevenue"][i - 1] if i else None
        out["revenue_growth"].append((rev / prev - 1) * 100 if rev and prev else None)
        nd, e = bal["NetDebt"][i], inc["EBITDA"][i]
        out["net_debt_ebitda"].append(nd / e if nd is not None and e else None)
    return out


@router.get("/equities/fa/sec")
def fa_sec(symbol: str, years: int = 15):
    """États annuels longs (jusqu'à 15 exercices) issus des 10-K déposés à la SEC (XBRL), ratios recalculés par exercice."""
    sym = symbol.strip().upper()
    years = max(3, min(years, 20))

    def fetch():
        facts = sec_provider.company_facts(_sec_cik(sym))
        try:
            t = sec.build(facts, years)
        except ValueError as e:
            raise SourceError(f"SEC : {sym} : {e}") from e
        return {"symbol": sym, "currency": "USD", **t, "ratios": ratio_history(t)}
    return cached(f"fa-sec:{sym}:{years}", 24 * 3600, "SEC EDGAR (10-K, XBRL)", fetch, status=HISTORICAL)


@router.get("/equities/comps")
def comps(symbols: str):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()][:12]
    if not syms:
        raise HTTPException(400, "Aucun symbole")

    def fetch():
        def one(s):
            try:
                f = fa(s)["data"]
                q = prices.quote(s)
                return {"symbol": s, "price": q.get("price"), "change_pct": q.get("change_pct"), "currency": f["currency"], "sector": f.get("sector"),
                        **{k: f["valuation"].get(k) for k in VALUATION}, **f["ratios"], "eps_ttm": f["ttm"].get("DilutedEPS")}
            except Exception as e:
                return {"symbol": s, "error": str(e)}
        with ThreadPoolExecutor(4) as ex:
            rows = list(ex.map(one, syms))
        if all("error" in r for r in rows):
            raise SourceError(rows[0]["error"])
        return rows
    return cached(f"comps:{','.join(syms)}", 3600, "Yahoo Finance", fetch, status=HISTORICAL)


# ─────────────────────────── Derivatives : options cotées ───────────────────────────
def _years_to(expiry: str, today: date) -> float:
    return max((date.fromisoformat(expiry) - today).days, 0) / 365


@router.get("/options/chain")
def chain(symbol: str, expiry: str = ""):
    env = cached(f"opt:{symbol.upper()}", 300, options.name, lambda: options.chain(symbol), status=DELAYED)
    d = env["data"]
    expiries = sorted({o["expiry"] for o in d["options"]})
    exp = expiry if expiry in expiries else next((e for e in expiries if e > d["today"]), expiries[0])
    by_k: dict[float, dict] = {}
    for o in d["options"]:
        if o["expiry"] == exp:
            by_k.setdefault(o["strike"], {"strike": o["strike"]})[o["type"]] = {k: v for k, v in o.items() if k not in ("expiry", "type", "strike")}
    stats = {e: {"calls_oi": sum((o["oi"] or 0) for o in d["options"] if o["expiry"] == e and o["type"] == "call"),
                 "puts_oi": sum((o["oi"] or 0) for o in d["options"] if o["expiry"] == e and o["type"] == "put")} for e in expiries}
    return {**env, "data": {"symbol": d["symbol"], "underlying": d["underlying"], "iv30": d["iv30"], "bid": d["bid"], "ask": d["ask"], "timestamp": d["timestamp"],
                            "expiries": expiries, "expiry": exp, "T": _years_to(exp, date.fromisoformat(d["today"])),
                            "rows": [by_k[k] for k in sorted(by_k)], "oi_by_expiry": stats}}


def surface_points(opts: list[dict], spot: float, today: date) -> list[dict]:
    """Points de volatilité implicite hors de la monnaie (puts sous le cours, calls au-dessus), avec intérêt ouvert non nul."""
    pts = []
    for o in opts:
        if not o["iv"] or o["iv"] <= 0 or not (o["oi"] or 0) > 0:
            continue
        m = o["strike"] / spot
        if (o["type"] == "put" and m <= 1) or (o["type"] == "call" and m >= 1):
            t = _years_to(o["expiry"], today)
            if t > 0 and 0.6 <= m <= 1.4:
                pts.append({"expiry": o["expiry"], "T": t, "moneyness": m, "strike": o["strike"], "iv": o["iv"] * 100})
    return pts


@router.get("/options/surface")
def surface(symbol: str):
    env = cached(f"opt:{symbol.upper()}", 300, options.name, lambda: options.chain(symbol), status=DELAYED)
    d = env["data"]
    pts = surface_points(d["options"], d["underlying"], date.fromisoformat(d["today"]))
    buckets = [0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.1, 1.15, 1.2]
    grid = []
    for e in sorted({p["expiry"] for p in pts}):
        row = {"expiry": e, "T": next(p["T"] for p in pts if p["expiry"] == e), "iv": []}
        for b in buckets:
            near = [p["iv"] for p in pts if p["expiry"] == e and abs(p["moneyness"] - b) <= 0.025]
            row["iv"].append(statistics.median(near) if near else None)
        if any(v is not None for v in row["iv"]):
            grid.append(row)
    return {**env, "data": {"symbol": symbol, "underlying": d["underlying"], "moneyness": buckets, "grid": grid, "points": len(pts)}}


@router.get("/options/hv")
def hist_vol(symbol: str):
    """Volatilité historique 10, 20, 60 et 250 séances (cône de volatilité simplifié)."""
    def fetch():
        c = [x["close"] for x in prices.history(symbol, "1d", "2y")["candles"]]
        r = [math.log(b / a) for a, b in zip(c, c[1:]) if a and b]
        def vol(x):
            m = sum(x) / len(x)
            return math.sqrt(sum((v - m) ** 2 for v in x) / (len(x) - 1) * 252) * 100
        out = {}
        for n in (10, 20, 60, 250):
            roll = [vol(r[i - n:i]) for i in range(n, len(r) + 1)] if len(r) > n else []
            out[str(n)] = {"current": roll[-1] if roll else None, "min": min(roll) if roll else None, "max": max(roll) if roll else None,
                           "median": statistics.median(roll) if roll else None}
        return out
    return cached(f"hv:{symbol.upper()}", 1800, prices.name, fetch, status=DELAYED)


# ─────────────────────────── Economics : impact des publications ───────────────────────────
RELEASES = {"cpi": (10, "Indice des prix (CPI)"), "nfp": (50, "Emploi (Employment Situation, NFP)"), "gdp": (53, "PIB (Gross Domestic Product)"),
            "retail": (9, "Ventes au détail"), "pce": (54, "Revenus et dépenses (PCE)"), "ppi": (46, "Prix à la production (PPI)")}
ASSETS = [("^GSPC", "S&P 500", "%"), ("^TNX", "Taux US 10 ans", "pb"), ("EURUSD=X", "EUR/USD", "%"), ("GC=F", "Or", "%"), ("CL=F", "WTI", "%")]


@router.get("/economics/impact")
def impact(release: str = "cpi", years: int = 5):
    """Réaction des actifs les jours de publication, comparée aux autres jours (mouvement absolu moyen)."""
    if release not in RELEASES:
        raise HTTPException(404, "Publication inconnue")
    rid, label = RELEASES[release]

    def fetch():
        if not config.FRED_API_KEY:
            raise SourceError("Clé FRED absente : renseigner FRED_API_KEY dans .env")
        start = (date.today() - timedelta(days=365 * years)).isoformat()
        j = macro._get("release/dates", release_id=rid, realtime_start=start, include_release_dates_with_no_data="false", sort_order="asc", limit=1000)
        days = sorted({d["date"] for d in j.get("release_dates", []) if start <= d["date"] <= date.today().isoformat()})
        out = []
        for sym, name, unit in ASSETS:
            h = prices.history(sym, "1d", f"{years + 1}y")["candles"]
            px = [(datetime.fromtimestamp(c["time"], timezone.utc).date().isoformat(), c["close"]) for c in h]
            moves = {d1: ((c1 - c0) * 100 if unit == "pb" else (c1 / c0 - 1) * 100) for (d0, c0), (d1, c1) in zip(px, px[1:]) if d1 >= start}
            on = [abs(moves[d]) for d in days if d in moves]
            off = [abs(v) for d, v in moves.items() if d not in days]
            signed = [moves[d] for d in days if d in moves]
            out.append({"symbol": sym, "name": name, "unit": unit, "n": len(on), "avg_abs_release": statistics.mean(on) if on else None,
                        "avg_abs_other": statistics.mean(off) if off else None, "ratio": statistics.mean(on) / statistics.mean(off) if on and off else None,
                        "up_pct": sum(x > 0 for x in signed) / len(signed) * 100 if signed else None,
                        "last": [{"date": d, "move": moves[d]} for d in days if d in moves][-8:]})
        return {"release": release, "label": label, "dates": days[-12:], "count": len(days), "assets": out}
    return cached(f"eco:impact:{release}:{years}", 12 * 3600, "FRED (dates) + Yahoo (cours)", fetch, status=HISTORICAL)


@router.get("/economics/central-banks")
def central_banks():
    from ..providers.registry import policy
    env = cached("policy", 6 * 3600, policy.name, policy.policy_rates)
    banks = [{**{k: b[k] for k in ("area", "bank", "rate", "date", "last_change", "previous")}, "history": b["steps"][-15:]} for b in env["data"]["banks"]]
    return {**env, "data": banks, "status": HISTORICAL}


@router.get("/market/bidask")
def bid_ask(symbol: str):
    """Meilleure offre et demande différées (CBOE, actions et ETF américains) pour l'exécution simulée."""
    def fetch():
        q = options.quote(symbol)
        if not q.get("bid") or not q.get("ask"):
            raise SourceError(f"CBOE : pas de fourchette affichée pour « {symbol} »")
        return q
    return cached(f"bidask:{symbol.upper()}", 30, "CBOE (différé)", fetch, status=DELAYED)
