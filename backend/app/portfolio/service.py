"""Assemble journal + cours + change + benchmark et produit la synthèse du portefeuille."""
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from .. import config, db
from ..cache import SourceError, cached
from ..providers.registry import fx as fx_provider
from ..providers.registry import policy, prices
from . import performance as perf
from .engine import position_rows, run
from .ledger import Tx

TYPE_FR = {"EQUITY": "Action hors indices suivis", "ETF": "ETF", "CRYPTOCURRENCY": "Crypto", "MUTUALFUND": "Fonds", "INDEX": "Indice", "CURRENCY": "Devise", "FUTURE": "Future"}

RF_AREA = {"EUR": "XM", "USD": "US", "GBP": "GB", "JPY": "JP", "CHF": "CH", "CAD": "CA", "AUD": "AU", "CNY": "CN"}
PERIODS = [("1J", 1), ("1S", 7), ("1M", 30), ("3M", 91), ("YTD", None), ("1A", 365), ("3A", 1095), ("Origine", -1)]
METHODS = {
    "twr": "Rendement pondéré par le temps : produit des rendements quotidiens r = (valeur fin + sorties) / (valeur veille + entrées) - 1.",
    "mwr": "Rendement pondéré par les flux : taux interne (XIRR, base 365 j) des apports, retraits et de la valeur finale ; annualisé au-delà d'un an.",
    "alpha": "Alpha de Jensen annualisé : ordonnée de la régression des rendements quotidiens excédentaires du portefeuille sur ceux du benchmark, x 252.",
    "beta": "Pente de la même régression (covariance / variance du benchmark).",
    "volatility": "Écart type des rendements quotidiens x racine de 252.",
    "sharpe": "Rendement excédentaire quotidien moyen / écart type, x racine de 252.",
    "sortino": "Rendement excédentaire moyen / écart type des seuls rendements inférieurs au taux sans risque, x racine de 252.",
    "max_drawdown": "Plus forte baisse entre un sommet et un creux de l'indice TWR sur la fenêtre.",
    "tracking_error": "Écart type de (portefeuille - benchmark) quotidien x racine de 252.",
    "information_ratio": "Surperformance quotidienne moyenne / tracking error, annualisée.",
    "correlation": "Corrélation des rendements quotidiens avec le benchmark.",
    "total_pct": "Performance totale : (plus-value latente + plus-value réalisée + dividendes - autres frais) / cumul des montants achetés, frais inclus.",
    "line_pct": "Performance d'une ligne : (valeur actuelle - coût d'achat) / coût d'achat, en devise de base, donc effet de change compris.",
    "pru": "Prix de revient unitaire : coût moyen pondéré, frais d'achat inclus, converti au taux de change du jour de chaque achat.",
    "effects": "Effet marché = quantité x (cours - PRU en devise de l'actif) au taux du jour ; effet change = coût en devise au taux du jour - coût historique.",
}


def load_txs() -> list[Tx]:
    with db.conn() as c:
        rows = c.execute("SELECT * FROM transactions ORDER BY date, id").fetchall()
    d = lambda v: Decimal(v) if v not in (None, "") else Decimal(0)
    return [Tx(r["date"], r["type"], r["currency"], r["symbol"] or "", d(r["quantity"]), d(r["price"]), d(r["amount"]), d(r["fees"]), r["id"], r["note"]) for r in rows]


class _Series:
    """Série datée avec lecture « dernière valeur connue »."""

    def __init__(self, points):
        self.dates = [p[0] for p in points]
        self.values = [p[1] for p in points]

    def at(self, d: str):
        i = bisect_right(self.dates, d)
        return self.values[i - 1] if i else None


class _Sources:
    def __init__(self):
        self.envs = []

    def get(self, key, ttl, source, fn):
        e = cached(key, ttl, source, fn)
        self.envs.append(e)
        return e["data"]

    def meta(self):
        ts = [e["fetched_at"] for e in self.envs if e["fetched_at"]]
        stale = [e for e in self.envs if e["stale"]]
        return {"source": " + ".join(dict.fromkeys(e["source"] for e in self.envs)), "fetched_at": min(ts) if ts else None,
                "stale": bool(stale), "error": stale[0]["error"] if stale else None}


def _asset(src: _Sources, symbol: str, start: str) -> dict:
    h = src.get(f"port:hist:{symbol}:{start}", 900, prices.name, lambda: prices.history(symbol, "1d", events=True, start=start))
    iso = lambda t: datetime.fromtimestamp(t + (h.get("gmtoffset") or 0), timezone.utc).date().isoformat()
    ccy, scale = h["currency"], 1.0
    if ccy == "GBp":  # cotation en pence
        ccy, scale = "GBP", 0.01
    splits = [(iso(s["time"]), s["ratio"]) for s in h.get("splits", [])]
    closes = [(iso(c["time"]), c["close"] * scale) for c in h["candles"]]
    adj = [(iso(c["time"]), c.get("adjclose", c["close"]) * scale) for c in h["candles"]]
    return {"symbol": symbol, "name": h["name"], "currency": ccy, "type": h.get("type"), "splits": splits,
            "raw": _Series(perf.unadjust_closes(closes, splits)), "adj": _Series(adj)}


def summary(window: str = "Origine") -> dict:
    from ..routers.screener import lookup
    txs = load_txs()
    base, bench_symbol = config.BASE_CURRENCY, config.BENCHMARK
    if not txs:
        return {"data": {"empty": True, "base": base, "benchmark": bench_symbol}, "source": "journal", "fetched_at": None, "stale": False, "error": None}
    src = _Sources()
    first = txs[0].date
    today = date.today().isoformat()
    # au moins 13 mois de cours, pour pouvoir simuler les lignes actuelles sur un an
    hist_start = min(date.fromisoformat(first) - timedelta(days=15), date.today() - timedelta(days=400)).isoformat()
    assets = {s: _asset(src, s, hist_start) for s in sorted({t.symbol for t in txs if t.symbol})}
    bench = _asset(src, bench_symbol, hist_start)

    # --- change : taux BCE, dernier taux connu à la date demandée
    fx_start = (date.fromisoformat(hist_start) - timedelta(days=15)).isoformat()
    need = ({a["currency"] for a in assets.values()} | {t.currency for t in txs} | {bench["currency"], base}) - {"EUR"}
    eur = {c: _Series(src.get(f"fx:{c}:{fx_start}", 6 * 3600, fx_provider.name, lambda c=c: fx_provider.rates(c, fx_start))) for c in need}

    def per_eur(c: str, d: str) -> Decimal:
        if c == "EUR":
            return Decimal(1)
        v = eur[c].at(d)
        if v is None:
            raise SourceError(f"Pas de taux de change {c} au {d}")
        return Decimal(str(v))

    def fx(a: str, b: str, d: str) -> Decimal:
        return Decimal(1) if a == b else per_eur(b, d) / per_eur(a, d)

    def price(symbol: str, d: str) -> float:
        v = assets[symbol]["raw"].at(d)
        if v is None:
            raise SourceError(f"Pas de cours pour {symbol} au {d}")
        return v

    # --- calendrier de valorisation : toutes les séances des actifs détenus et du benchmark
    all_dates = set(bench["raw"].dates)
    for a in assets.values():
        all_dates.update(a["raw"].dates)
    dates = sorted(d for d in all_dates if first <= d <= today)
    if not dates or dates[0] > first:
        dates = [first] + dates
    asset_ccy = {s: a["currency"] for s, a in assets.items()}
    res = run(txs, dates, price, asset_ccy, fx, base)
    rows, led, warnings = res["rows"], res["ledger"], list(res["warnings"])

    V = [r["value"] for r in rows]
    IN = [r["inflow"] for r in rows]
    OUT = [r["outflow"] for r in rows]
    R = perf.daily_returns(V, IN, OUT)
    twr_idx = perf.index_series(R)
    B = [(bench["adj"].at(d) or 0) * float(fx(bench["currency"], base, d)) for d in dates]
    RB = [None] + [(B[i] / B[i - 1] - 1) if B[i - 1] else None for i in range(1, len(B))]
    bench_idx = [100 * b / B[0] if B[0] else None for b in B]
    invested, cum = [], 0.0
    for i, o in zip(IN, OUT):
        cum += i - o
        invested.append(cum)

    # --- taux sans risque : taux directeur de la zone de la devise de base
    rf_note = None
    try:
        banks = src.get("policy", 6 * 3600, policy.name, policy.policy_rates)["banks"]
        b = next(x for x in banks if x["area"] == RF_AREA.get(base, "XM"))
        rf_series = _Series(b["steps"])
        RF = [(rf_series.at(d) or 0) / 100 / perf.ANN for d in dates]
        rf_note = f"taux directeur {b['bank']}"
    except Exception as e:  # la synthèse reste calculable, mais on le dit
        RF = [0.0] * len(dates)
        warnings.append(f"Taux sans risque indisponible ({e}) : 0 % utilisé pour alpha, Sharpe et Sortino.")

    # --- périodes
    last = date.fromisoformat(dates[-1])
    periods = []
    for label, days in PERIODS:
        if days == -1:
            i0 = -1
        else:
            start = date(last.year - 1, 12, 31).isoformat() if days is None else (last - timedelta(days=days)).isoformat()
            if label == "1J":
                i0 = len(dates) - 2
            else:
                i0 = bisect_right(dates, start) - 1
            if i0 < 0:
                periods.append({"label": label, "available": False})
                continue
        sl = slice(i0 + 1, None)
        flows = ([(dates[i0], -V[i0])] if i0 >= 0 else [])
        for j in range(i0 + 1, len(dates)):
            if IN[j]:
                flows.append((dates[j], -IN[j]))
            if OUT[j]:
                flows.append((dates[j], OUT[j]))
        flows.append((dates[-1], V[-1]))
        n_days = (last - date.fromisoformat(dates[max(i0, 0)])).days
        irr = perf.xirr(flows) if n_days > 0 else None
        twr = perf.chain(R[sl])
        b0 = B[max(i0, 0)]
        bret = (B[-1] / b0 - 1) if b0 else None
        ann = (lambda x: (1 + x) ** (365 / n_days) - 1) if n_days > 365 else (lambda x: None)
        periods.append({"label": label, "available": True, "from": dates[max(i0, 0)], "days": n_days, "twr": twr, "benchmark": bret,
                        "excess": twr - bret if bret is not None else None,
                        "mwr": perf.deannualize(irr, n_days) if irr is not None else None,
                        "twr_annual": ann(twr), "benchmark_annual": ann(bret) if bret is not None else None,
                        "mwr_annual": irr if irr is not None and n_days > 365 else None})

    # --- risque sur la fenêtre choisie
    wdays = {"6M": 182, "1A": 365, "3A": 1095}.get(window)
    wstart = (last - timedelta(days=wdays)).isoformat() if wdays else dates[0]
    trip = [(R[i], RB[i], RF[i]) for i in range(len(dates)) if dates[i] > wstart and R[i] is not None and RB[i] is not None]
    risk = perf.risk(*zip(*trip)) if trip else {"n": 0}
    risk.update({"window": window, "from": wstart, "to": dates[-1], "risk_free": rf_note})

    # --- positions
    pos = position_rows(led, price, fx, base, dates[-1])
    total_value = sum((p["value"] for p in pos), Decimal(0)) + (res["cash"] if res["tracked"] else Decimal(0))
    prev = {p.symbol: None for p in led.positions.values()}
    for s in prev:  # clôture précédente de l'actif lui-même, même si le journal ne commence qu'aujourd'hui
        ser = assets[s]["raw"]
        i = bisect_right(ser.dates, dates[-1])
        prev[s] = ser.values[i - 2] if i >= 2 else None
    for p in pos:
        a = assets[p["symbol"]]
        p.update({"name": a["name"], "type": a["type"], "weight": (p["value"] / total_value) if total_value else Decimal(0),
                  "day_pct": (float(p["price"]) / prev[p["symbol"]] - 1) if p["price"] and prev[p["symbol"]] else None,
                  "pnl_pct": (p["unrealized"] / p["cost_base"]) if p["cost_base"] else None})
    pos.sort(key=lambda p: p["value"], reverse=True)
    total_pnl = sum((p["total_pnl"] for p in pos), Decimal(0)) - led.fees_other
    for p in pos:
        p["contribution"] = (p["total_pnl"] / total_pnl) if total_pnl else None

    # Variation du jour : mouvement de cours des lignes détenues depuis la clôture précédente
    # (indépendant de la date de saisie des lignes, contrairement au rendement TWR du jour).
    held = sum(float(p["value"]) for p in pos)
    day_change = sum(float(p["value"]) * p["day_pct"] / (1 + p["day_pct"]) for p in pos if p["day_pct"] is not None and p["value"])
    bought = sum((p["bought"] for p in pos), Decimal(0))
    cost_now = sum((p["cost_base"] for p in pos), Decimal(0))

    def alloc(keyf):
        out: dict[str, Decimal] = {}
        for p in pos:
            if p["value"]:
                out[keyf(p)] = out.get(keyf(p), Decimal(0)) + p["value"]
        if res["tracked"] and res["cash"] > 0:
            out["Liquidités"] = res["cash"]
        return [{"key": k, "value": v, "weight": v / total_value} for k, v in sorted(out.items(), key=lambda kv: -kv[1])]

    # --- contrôle des splits : Yahoo en signale-t-il un absent du journal pendant la détention ?
    for s, a in assets.items():
        buys = [t.date for t in txs if t.symbol == s and t.type == "BUY"]
        logged = [t.date for t in txs if t.symbol == s and t.type == "SPLIT"]
        for sd, ratio in a["splits"]:
            if buys and sd > min(buys) and not any(abs((date.fromisoformat(sd) - date.fromisoformat(x)).days) <= 5 for x in logged):
                warnings.append(f"{s} : division {ratio:g}-pour-1 le {sd} signalée par Yahoo mais absente du journal. Ajouter une ligne SPLIT, sinon quantité et valorisation sont fausses.")

    # --- simulation : lignes actuelles supposées détenues depuis un an, quantités constantes, dividendes réinvestis
    simulated = None
    held_now = [p for p in pos if p["qty"]]
    if held_now:
        sim_from = (last - timedelta(days=365)).isoformat()
        listed = max((assets[p["symbol"]]["adj"].dates[0] for p in held_now), default=sim_from)
        sim_from = max(sim_from, listed, bench["adj"].dates[0])
        sdates = sorted({d for p in held_now for d in assets[p["symbol"]]["adj"].dates if sim_from <= d <= dates[-1]} | {d for d in bench["adj"].dates if sim_from <= d <= dates[-1]})
        if len(sdates) >= 2:
            sv = [sum(float(p["qty"]) * assets[p["symbol"]]["adj"].at(d) * float(fx(p["currency"], base, d)) for p in held_now) for d in sdates]
            sb = [bench["adj"].at(d) * float(fx(bench["currency"], base, d)) for d in sdates]
            simulated = {"dates": sdates, "portfolio": [100 * v / sv[0] for v in sv], "benchmark": [100 * b / sb[0] for b in sb],
                         "return": sv[-1] / sv[0] - 1, "benchmark_return": sb[-1] / sb[0] - 1, "from": sdates[0]}

    f = lambda x: float(x) if isinstance(x, Decimal) else x
    data = {
        "empty": False, "base": base, "benchmark": {"symbol": bench_symbol, "name": bench["name"], "currency": bench["currency"]},
        "as_of": dates[-1], "tracked_cash": res["tracked"],
        "totals": {"value": f(total_value), "cash": f(res["cash"]) if res["tracked"] else None, "net_invested": invested[-1],
                   "cost": f(sum((p["cost_base"] for p in pos), Decimal(0))), "unrealized": f(sum((p["unrealized"] for p in pos), Decimal(0))),
                   "market_effect": f(sum((p["market_effect"] for p in pos), Decimal(0))), "fx_effect": f(sum((p["fx_effect"] for p in pos), Decimal(0))),
                   "realized": f(sum((p["realized"] for p in pos), Decimal(0))), "dividends": f(sum((p["dividends"] for p in pos), Decimal(0))),
                   "fees_other": f(led.fees_other), "total_pnl": f(total_pnl),
                   "bought": f(bought), "total_pct": f(total_pnl / bought) if bought else None,
                   "unrealized_pct": f(sum((p["unrealized"] for p in pos), Decimal(0)) / cost_now) if cost_now else None,
                   "day_pct": day_change / (held - day_change) if held - day_change > 0 else None, "day_change": day_change},
        "positions": [{k: f(v) for k, v in p.items()} for p in pos],
        "periods": periods, "risk": risk,
        "allocations": {"Actif": [{k: f(v) for k, v in a.items()} for a in alloc(lambda p: p["symbol"])],
                        "Devise": [{k: f(v) for k, v in a.items()} for a in alloc(lambda p: p["currency"])],
                        "Secteur": [{k: f(v) for k, v in a.items()} for a in alloc(lambda p: (lookup(p["symbol"]) or {}).get("sector") or TYPE_FR.get(p["type"], "Non classé"))],
                        "Pays": [{k: f(v) for k, v in a.items()} for a in alloc(lambda p: (lookup(p["symbol"]) or {}).get("country") or TYPE_FR.get(p["type"], "Non classé"))],
                        "Type": [{k: f(v) for k, v in a.items()} for a in alloc(lambda p: TYPE_FR.get(p["type"], p["type"] or "?"))]},
        "series": {"dates": dates, "value": V, "invested": invested, "twr": twr_idx, "benchmark": bench_idx},
        "simulated": simulated, "warnings": warnings, "methods": METHODS,
    }
    return {"data": data, **src.meta()}
