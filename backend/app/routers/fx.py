"""Forex : tableau des paires, force des devises, corrélations, taux directeurs, positionnement CFTC (TFF), saisonnalité."""
import math
import statistics
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException

from ..analytics import perf_stats
from ..cache import DELAYED, HISTORICAL, SourceError, cached
from ..providers.registry import cot, policy, prices
from .commodities import seasonality_from_monthly

router = APIRouter(prefix="/api/fx", tags=["forex"])

# (paire, groupe)
PAIRS = [
    ("EURUSD", "Majeures"), ("GBPUSD", "Majeures"), ("USDJPY", "Majeures"), ("USDCHF", "Majeures"),
    ("AUDUSD", "Majeures"), ("USDCAD", "Majeures"), ("NZDUSD", "Majeures"),
    ("EURGBP", "Croisées"), ("EURJPY", "Croisées"), ("EURCHF", "Croisées"), ("GBPJPY", "Croisées"),
    ("AUDJPY", "Croisées"), ("EURAUD", "Croisées"), ("GBPCHF", "Croisées"), ("CADJPY", "Croisées"), ("AUDNZD", "Croisées"),
    ("USDSEK", "Scandinaves et Europe centrale"), ("USDNOK", "Scandinaves et Europe centrale"),
    ("EURSEK", "Scandinaves et Europe centrale"), ("EURNOK", "Scandinaves et Europe centrale"), ("EURPLN", "Scandinaves et Europe centrale"),
    ("USDCNY", "Émergentes"), ("USDMXN", "Émergentes"), ("USDBRL", "Émergentes"), ("USDZAR", "Émergentes"),
    ("USDTRY", "Émergentes"), ("USDINR", "Émergentes"), ("USDKRW", "Émergentes"), ("USDSGD", "Émergentes"), ("USDHKD", "Émergentes"),
]
DXY = "DX-Y.NYB"
# Actifs hors change pour les corrélations croisées
CROSS_ASSETS = {"Or": "GC=F", "S&P 500": "^GSPC", "Taux US 10 ans": "^TNX", "Pétrole WTI": "CL=F", "VIX": "^VIX"}
YIELD_LIKE = {"Taux US 10 ans", "Taux US 2 ans", "Écart 2 ans EUR − US"}  # variations en points, pas en %
CORR_SET = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD", "USDCAD", "NZDUSD", "USDCNY", "USDMXN", "EURGBP", "EURJPY"]

# devise : (nom, zone BRI, banque centrale, G10)
CCY = {
    "USD": ("Dollar américain", "US", "Fed", True), "EUR": ("Euro", "XM", "BCE", True), "JPY": ("Yen", "JP", "BoJ", True),
    "GBP": ("Livre sterling", "GB", "BoE", True), "CHF": ("Franc suisse", "CH", "BNS", True), "CAD": ("Dollar canadien", "CA", "BdC", True),
    "AUD": ("Dollar australien", "AU", "RBA", True), "NZD": ("Dollar néo-zélandais", "NZ", "RBNZ", True),
    "SEK": ("Couronne suédoise", "SE", "Riksbank", True), "NOK": ("Couronne norvégienne", "NO", "Norges Bank", True),
    "CNY": ("Yuan", "CN", "PBoC", False), "MXN": ("Peso mexicain", "MX", "Banxico", False), "BRL": ("Réal brésilien", "BR", "BCB", False),
    "ZAR": ("Rand sud-africain", "ZA", "SARB", False), "TRY": ("Livre turque", "TR", "TCMB", False), "INR": ("Roupie indienne", "IN", "RBI", False),
    "KRW": ("Won sud-coréen", "KR", "BoK", False), "PLN": ("Zloty", "PL", "NBP", False), "HKD": ("Dollar de Hong Kong", "HK", "HKMA", False),
    "SGD": ("Dollar de Singapour", "SG", "MAS", False),
}

# Contrats à terme CFTC (rapport TFF) : devise -> (code, taille du contrat en devise ; USD : 1 000 $ × indice)
COT_MARKETS = {"EUR": ("099741", 125_000), "JPY": ("097741", 12_500_000), "GBP": ("096742", 62_500), "CHF": ("092741", 125_000),
               "CAD": ("090741", 100_000), "AUD": ("232741", 100_000), "NZD": ("112741", 100_000), "MXN": ("095741", 500_000),
               "BRL": ("102741", 100_000), "ZAR": ("122741", 500_000), "USD": ("098662", 1_000)}
COT_LOOKBACK = 156  # semaines : fenêtre de l'indice COT (3 ans)

HORIZONS = {"d1": 1, "w1": 5, "m1": 21, "m3": 63, "y1": 250}


# ─────────────────────────── calculs purs ───────────────────────────
def log_returns(closes: list[float]) -> list[float]:
    return [math.log(b / a) for a, b in zip(closes, closes[1:]) if a and b]


def realised_vol(closes: list[float], n: int) -> float | None:
    r = log_returns(closes[-(n + 1):])
    return statistics.stdev(r) * math.sqrt(252) * 100 if len(r) >= 2 else None


def rsi(closes: list[float], n: int = 14) -> float | None:
    """RSI de Wilder sur les clôtures."""
    if len(closes) <= n:
        return None
    g = l = 0.0
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        up, dn = max(d, 0), max(-d, 0)
        if i <= n:
            g += up / n
            l += dn / n
        else:
            g = (g * (n - 1) + up) / n
            l = (l * (n - 1) + dn) / n
    return 100.0 if l == 0 else 100 - 100 / (1 + g / l)


def correlation(a: list[float], b: list[float]) -> float | None:
    if len(a) < 3 or len(a) != len(b):
        return None
    ma, mb = statistics.fmean(a), statistics.fmean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return num / den if den else None


def align(series: dict[str, dict[str, float]]) -> tuple[list[str], dict[str, list[float]]]:
    """Dates communes à toutes les séries {nom: {date: clôture}}, et clôtures alignées sur ces dates."""
    common = sorted(set.intersection(*(set(s) for s in series.values()))) if series else []
    return common, {k: [s[d] for d in common] for k, s in series.items()}


def usd_value(ccy: str, closes_by_pair: dict[str, dict[str, float]]) -> dict[str, float] | None:
    """Valeur d'une unité de `ccy` en dollars, par date, à partir de la paire contre dollar disponible."""
    if ccy == "USD":
        return None
    if f"{ccy}USD" in closes_by_pair:
        return dict(closes_by_pair[f"{ccy}USD"])
    if f"USD{ccy}" in closes_by_pair:
        return {d: 1 / v for d, v in closes_by_pair[f"USD{ccy}"].items() if v}
    return None


def strength_table(usd_vals: dict[str, list[float]], dates: list[str], g10: set[str]) -> list[dict]:
    """Force relative de chaque devise : sa variation contre dollar moins la variation moyenne du panier G10 (dollar inclus, à 0).

    Une valeur positive signifie que la devise s'est appréciée face à la moyenne des devises du G10 sur la période.
    """
    year = dates[-1][:4] if dates else ""
    ytd_i = max((i for i, d in enumerate(dates) if d[:4] < year), default=None)
    rets: dict[str, dict[str, float | None]] = {}
    for c, v in usd_vals.items():
        r: dict[str, float | None] = {}
        for h, n in HORIZONS.items():
            r[h] = (v[-1] / v[-1 - n] - 1) * 100 if len(v) > n and v[-1 - n] else None
        r["ytd"] = (v[-1] / v[ytd_i] - 1) * 100 if ytd_i is not None and v[ytd_i] else None
        rets[c] = r
    rets["USD"] = {h: 0.0 for h in [*HORIZONS, "ytd"]}
    out = []
    for c, r in rets.items():
        row = {"ccy": c, "name": CCY[c][0], "g10": CCY[c][3]}
        for h in [*HORIZONS, "ytd"]:
            basket = [rets[x][h] for x in g10 if x in rets and rets[x][h] is not None]
            row[h] = r[h] - statistics.fmean(basket) if r[h] is not None and basket else None
        out.append(row)
    return out


def position_stats(nets: list[float], oi: float, lookback: int = COT_LOOKBACK) -> dict:
    """Position nette d'une catégorie : dernière valeur, variation hebdomadaire, indice COT (0-100) et z-score sur `lookback` semaines."""
    w = nets[-lookback:]
    last = nets[-1]
    lo, hi = min(w), max(w)
    sd = statistics.stdev(w) if len(w) > 2 else 0
    return {"net": last, "chg": last - nets[-2] if len(nets) > 1 else None,
            "index": (last - lo) / (hi - lo) * 100 if hi > lo else None,
            "z": (last - statistics.fmean(w)) / sd if sd else None,
            "pct_oi": last / oi * 100 if oi else None, "min": lo, "max": hi}


def changes(values: list[float], kind: str) -> list[float]:
    """Rendements log (prix) ou variations en points (taux)."""
    if kind == "yield":
        return [b - a for a, b in zip(values, values[1:])]
    return log_returns(values)


def driver_stats(dates: list[str], pair: list[float], drv: list[float], kind: str, roll: int = 60) -> dict:
    """Lien entre une paire et un moteur : corrélations 20/60/250, bêta sur 250 séances, corrélation glissante.

    Bêta : variation de la paire en % pour +1 % du moteur (prix) ou pour +10 pb (taux).
    Rupture : la corrélation 20 séances s'écarte de plus de 0,5 de celle d'un an.
    """
    rp = [x * 100 for x in log_returns(pair)]
    rx = changes(drv, kind)
    rx = [x * 100 for x in rx] if kind != "yield" else [x * 10 for x in rx]  # par 1 % ou par 10 pb
    n = min(len(rp), len(rx))
    rp, rx, d = rp[-n:], rx[-n:], dates[-n:]
    c = {w: correlation(rp[-w:], rx[-w:]) for w in (20, 60, 250)}
    w = rx[-250:]
    var = statistics.pvariance(w) if len(w) > 2 else 0
    beta = (sum((a - statistics.fmean(w)) * (b - statistics.fmean(rp[-250:])) for a, b in zip(w, rp[-250:])) / len(w)) / var if var else None
    rolling = [[d[i], None if (x := correlation(rp[i - roll + 1:i + 1], rx[i - roll + 1:i + 1])) is None else round(x, 3)]
               for i in range(roll - 1, n)][-250:]
    brk = c[20] is not None and c[250] is not None and abs(c[20] - c[250]) > 0.5
    return {"corr20": c[20], "corr60": c[60], "corr250": c[250], "beta": beta, "break": brk, "rolling": rolling}


def basket_returns(usd_vals: dict[str, list[float]]) -> dict[str, list[float]]:
    """Rendements log de chaque devise contre le panier équipondéré (dollar inclus, à 0)."""
    r = {c: log_returns(v) for c, v in usd_vals.items()}
    n = min(len(v) for v in r.values())
    r = {c: v[-n:] for c, v in r.items()}
    r["USD"] = [0.0] * n
    mean = [statistics.fmean(r[c][i] for c in r) for i in range(n)]
    return {c: [x - m for x, m in zip(v, mean)] for c, v in r.items()}


def rolling_index(nets: list[float], lookback: int) -> list[float | None]:
    """Indice COT glissant : position de chaque semaine dans la fourchette des `lookback` semaines précédentes (incluse)."""
    out: list[float | None] = []
    for i in range(len(nets)):
        w = nets[max(0, i - lookback + 1):i + 1]
        lo, hi = min(w), max(w)
        out.append((nets[i] - lo) / (hi - lo) * 100 if hi > lo and len(w) >= lookback // 2 else None)
    return out


def price_on(series: list[tuple[str, float]], d: str) -> float | None:
    """Dernière clôture à la date `d` ou avant (séries triées)."""
    out = None
    for day, v in series:
        if day > d:
            break
        out = v
    return out


# ─────────────────────────── données ───────────────────────────
def _day(ts: int) -> str:
    """Date UTC d'un horodatage décalé de 6 h : les bougies Yahoo sont horodatées à minuit Londres (23 h UTC la veille
    en été) pour le change, à l'ouverture pour les actions, à 5 h UTC pour les contrats ICE et COMEX."""
    return datetime.fromtimestamp(ts + 6 * 3600, timezone.utc).strftime("%Y-%m-%d")


def prev_weekday(d: str) -> str:
    x = date.fromisoformat(d) - timedelta(days=1)
    while x.weekday() >= 5:
        x -= timedelta(days=1)
    return x.isoformat()


def series_dates(symbol: str, ts: list[int]) -> list[str]:
    """Jour de bourse de chaque clôture. La clôture quotidienne d'une paire de change Yahoo datée du jour J est le cours
    relevé à l'ouverture de J (minuit Londres), c'est-à-dire la clôture de la séance précédente : vérifié par la
    corrélation EUR/USD − DXY (−0,1 à même date, −0,8 une fois la paire ramenée d'un jour ouvré)."""
    d = [_day(t) for t in ts]
    return [prev_weekday(x) for x in d] if symbol.endswith("=X") else d


def quote_date(ts: int) -> str:
    """Séance d'un cours du moment : sa date UTC, ramenée au vendredi le week-end (marché fermé)."""
    d = datetime.fromtimestamp(ts, timezone.utc).date()
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d.isoformat()


def merge_live(dates: list[str], closes: list[float], qdate: str | None, qprice: float | None) -> tuple[list[str], list[float]]:
    """Ajoute le dernier cours connu comme clôture du jour (ou remplace la clôture du même jour)."""
    if not qdate or qprice is None or not dates:
        return dates, closes
    if qdate == dates[-1]:
        return dates, closes[:-1] + [qprice]
    if qdate > dates[-1]:
        return dates + [qdate], closes + [qprice]
    return dates, closes


def _spark(symbols: list[str], range_: str = "1y", live: bool = False) -> dict[str, dict]:
    """Clôtures quotidiennes datées par jour de bourse : {symbole: {d: [...], c: [...]}} ; `live` ajoute le cours du moment."""
    raw: dict[str, dict] = {}
    for i in range(0, len(symbols), 20):  # 20 symboles au plus par appel
        raw.update(prices.spark(symbols[i:i + 20], range_, "1d"))
    q = {}
    if live:
        try:
            q = {x["symbol"]: x for x in prices.quotes(list(raw)) if "error" not in x}
        except Exception:  # le cours du moment est un complément
            q = {}
    out = {}
    for sym, v in raw.items():
        d = series_dates(sym, v["t"])
        # dédoublonnage (deux bougies ramenées sur le même jour : on garde la dernière)
        by = dict(zip(d, v["c"]))
        d, c = sorted(by), [by[x] for x in sorted(by)]
        qq = q.get(sym)
        if qq and qq.get("time"):
            d, c = merge_live(d, c, quote_date(qq["time"]), qq.get("price"))
        out[sym] = {"d": d, "c": c}
    return out


def _closes() -> dict:
    """Clôtures quotidiennes sur un an de toutes les paires, du DXY et des actifs croisés : {nom: {d, c}}."""
    def fetch():
        sp = _spark([f"{p}=X" for p, _ in PAIRS] + [DXY, *CROSS_ASSETS.values()], live=True)
        if not sp:
            raise SourceError("Yahoo : aucune cotation de change reçue")
        out = {p: sp[f"{p}=X"] for p, _ in PAIRS if f"{p}=X" in sp}
        if DXY in sp:
            out["DXY"] = sp[DXY]
        for k, s in CROSS_ASSETS.items():
            if s in sp:
                out[k] = sp[s]
        return out
    return cached("fx:closes:v2", 300, prices.name, fetch, status=DELAYED)


def _by_date(s: dict) -> dict[str, float]:
    return dict(zip(s["d"], s["c"]))


def _epoch(d: str) -> int:
    return int(datetime.fromisoformat(d + "T12:00:00+00:00").timestamp())


def _policy() -> dict:
    areas = {v[1]: v[2] for v in CCY.values()}
    return cached("fx:policy", 6 * 3600, policy.name, lambda: policy.policy_rates("2018-01-01", areas=areas), status=HISTORICAL)


def _rates_by_ccy() -> dict[str, float]:
    try:
        banks = {b["area"]: b for b in _policy()["data"]["banks"]}
    except HTTPException:
        return {}
    return {c: banks[v[1]]["rate"] for c, v in CCY.items() if v[1] in banks}


# ─────────────────────────── points d'API ───────────────────────────
@router.get("/board")
def fx_board():
    """Paires au comptant : variations, fourchette 52 semaines, volatilités réalisées, tendance, RSI, portage."""
    env = _closes()
    data, rates = env["data"], _rates_by_ccy()
    rows = []
    for p, group in [*PAIRS, ("DXY", "Indice dollar")]:
        s = data.get(p)
        if not s:
            rows.append({"pair": p, "group": group, "error": "pas de cours reçu"})
            continue
        c = s["c"]
        st = perf_stats([{"time": t, "open": x, "high": x, "low": x, "close": x, "volume": 0} for t, x in zip(map(_epoch, s["d"]), c)])
        sma50 = statistics.fmean(c[-50:]) if len(c) >= 50 else None
        sma200 = statistics.fmean(c[-200:]) if len(c) >= 200 else None
        base, quote = p[:3], p[3:]
        carry = rates[base] - rates[quote] if p != "DXY" and base in rates and quote in rates else None
        hv3m = realised_vol(c, 63)
        rows.append({"pair": p, "group": group, "symbol": DXY if p == "DXY" else f"{p}=X",
                     **{k: st.get(k) for k in ("last", "d1", "w1", "m1", "ytd", "hi52", "lo52", "range_pos")},
                     "hv1m": realised_vol(c, 21), "hv3m": hv3m, "hv1y": realised_vol(c, 250), "rsi": rsi(c[-120:]),
                     "sma50": sma50, "sma200": sma200, "vs_sma200": (c[-1] / sma200 - 1) * 100 if sma200 else None,
                     "carry": carry, "carry_vol": carry / hv3m if carry is not None and hv3m else None, "spark": c[-60:]})
    return {**env, "data": rows}


@router.get("/strength")
def fx_strength():
    """Force relative des devises contre le panier G10, et trajectoire sur 3 mois des devises du G10."""
    env = _closes()
    by_pair = {p: _by_date(env["data"][p]) for p, _ in PAIRS if p in env["data"]}
    vals = {c: v for c in CCY if (v := usd_value(c, by_pair))}
    g10 = {c for c, v in CCY.items() if v[3]}
    dates, aligned = align({c: v for c, v in vals.items() if c in g10})
    table = strength_table(aligned, dates, g10)
    # devises hors G10 : alignées séparément pour ne pas réduire l'historique commun
    for c in [c for c in vals if c not in g10]:
        d2, a2 = align({**{k: vals[k] for k in g10 if k in vals}, c: vals[c]})
        row = next((r for r in strength_table(a2, d2, g10) if r["ccy"] == c), None)
        if row:
            table.append(row)
    # trajectoire : indice base 100 de chaque devise G10 contre la moyenne géométrique du panier, sur 63 séances
    n = min(63, len(dates) - 1)
    path = {}
    if n > 0:
        idx = range(len(dates) - n - 1, len(dates))
        logs = {c: [math.log(aligned[c][i] / aligned[c][idx[0]]) for i in idx] for c in aligned}
        logs["USD"] = [0.0] * len(idx)
        for c, l in logs.items():
            path[c] = [round(100 * math.exp(x - statistics.fmean(logs[k][j] for k in logs)), 3) for j, x in enumerate(l)]
        path = {"dates": [dates[i] for i in idx], "series": path}
    return {**env, "data": {"table": sorted(table, key=lambda r: -(r["w1"] or 0)), "path": path, "date": dates[-1] if dates else None}}


@router.get("/corr")
def fx_corr():
    """Corrélations des rendements quotidiens (20, 60 et 250 séances) entre paires majeures, DXY et actifs croisés."""
    env = _closes()
    names = [p for p in CORR_SET if p in env["data"]] + [k for k in ["DXY", *CROSS_ASSETS] if k in env["data"]]
    dates, al = align({k: _by_date(env["data"][k]) for k in names})
    rets = {k: log_returns(v) for k, v in al.items()}
    out = {}
    for w in (20, 60, 250):
        r = {k: v[-w:] for k, v in rets.items()}
        out[str(w)] = [[None if (x := correlation(r[a], r[b])) is None else round(x, 3) for b in names] for a in names]
    by_pair = {p: _by_date(env["data"][p]) for p, _ in PAIRS if p in env["data"]}
    g10 = [c for c, v in CCY.items() if v[3]]
    vals = {c: v for c in g10 if (v := usd_value(c, by_pair))}
    _, al2 = align(vals)
    br = basket_returns(al2)
    ccys = [c for c in g10 if c in br]
    cw = {}
    for w in (20, 60, 250):
        r = {k: v[-w:] for k, v in br.items()}
        cw[str(w)] = [[None if (x := correlation(r[a], r[b])) is None else round(x, 3) for b in ccys] for a in ccys]
    return {**env, "data": {"labels": names, "windows": out, "ccy_labels": ccys, "ccy_windows": cw, "obs": len(dates) - 1, "date": dates[-1] if dates else None}}


def _us2y() -> dict[str, float]:
    from . import macro as macro_router
    rows = macro_router.yields(2)["data"]["nominal"]
    return {r["date"]: r["2A"] for r in rows if r.get("2A") is not None}


def _eur2y() -> dict[str, float]:
    import csv
    import io
    from ..providers.http import get

    def fetch():
        start = (date.today() - timedelta(days=800)).isoformat()
        text = get("https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_2Y", params={"format": "csvdata", "startPeriod": start}).text
        out = {r["TIME_PERIOD"]: float(r["OBS_VALUE"]) for r in csv.DictReader(io.StringIO(text)) if r.get("OBS_VALUE")}
        if not out:
            raise SourceError("BCE : taux 2 ans indisponible")
        return out
    return cached("fx:eur2y", 6 * 3600, "BCE (courbe AAA)", fetch, status=HISTORICAL)["data"]


@router.get("/drivers")
def fx_drivers(pair: str):
    """Moteurs d'une paire : écart de taux 2 ans (EUR/USD), taux US, dollar, actifs risqués, matières premières."""
    pair = pair.upper().replace("/", "")
    if pair not in {p for p, _ in PAIRS} | {"DXY"}:
        raise HTTPException(404, f"Paire non suivie : {pair}")

    def fetch():
        closes = _closes()["data"]
        if pair not in closes:
            raise SourceError(f"Yahoo : pas de cours pour {pair}")
        drv: dict[str, tuple[dict[str, float], str]] = {}
        notes = []
        if pair in ("EURUSD", "DXY"):
            try:
                us, eu = _us2y(), _eur2y()
                drv["Écart 2 ans EUR − US"] = ({d: eu[d] - us[d] for d in eu if d in us}, "yield")
            except Exception as e:  # le moteur de taux est un complément
                notes.append(f"Écart de taux 2 ans indisponible : {e}")
        if "USD" in pair or pair == "DXY":
            try:
                drv["Taux US 2 ans"] = (_us2y(), "yield")
            except Exception as e:
                notes.append(f"Taux US 2 ans indisponible : {e}")
        if pair != "DXY" and "DXY" in closes:
            drv["DXY"] = (_by_date(closes["DXY"]), "price")
        for k in CROSS_ASSETS:
            if k in closes:
                drv[k] = (_by_date(closes[k]), "yield" if k in YIELD_LIKE else "price")
        p = _by_date(closes[pair])
        out = []
        for name, (series, kind) in drv.items():
            dates, al = align({"p": p, "x": series})
            if len(dates) < 30:
                continue
            st = driver_stats(dates, al["p"], al["x"], kind)
            out.append({"name": name, "kind": kind, **st, "level": [[d, v] for d, v in zip(dates[-250:], al["x"][-250:])]})
        out.sort(key=lambda r: -abs(r["corr60"] or 0))
        return {"pair": pair, "drivers": out, "pair_series": [[d, v] for d, v in sorted(p.items())[-250:]], "notes": notes}
    return cached(f"fx:drivers:{pair}", 900, f"{prices.name} · U.S. Treasury · BCE", fetch, status=DELAYED)


@router.get("/rates")
def fx_rates():
    """Taux directeurs par devise (BRI), dernier mouvement et taux précédent."""
    p = _policy()
    by_area = {b["area"]: b for b in p["data"]["banks"]}
    rows = []
    for c, (name, area, bank, g10) in CCY.items():
        b = by_area.get(area)
        if not b:
            continue
        prev = b.get("previous")
        rows.append({"ccy": c, "name": name, "bank": bank, "g10": g10, "rate": b["rate"], "date": b["date"], "last_change": b.get("last_change"),
                     "previous": prev, "move": None if prev is None else round(b["rate"] - prev, 4),
                     "steps": [s for s in b["steps"] if s[0] >= "2021-01-01"]})
    return {**p, "data": rows}


@router.get("/cot")
def fx_cot():
    """Positionnement CFTC sur les contrats de devises (rapport TFF + legacy), notionnel en dollars, historique 3 ans."""
    def fetch():
        since = (date.today() - timedelta(weeks=2 * COT_LOOKBACK + 4)).isoformat()
        codes = {v[0]: k for k, v in COT_MARKETS.items()}
        tff = cot.tff(list(codes), since)
        try:
            leg = cot.legacy(list(codes), since)
        except Exception:  # le rapport legacy est un complément
            leg = {}
        # cours quotidiens sur 5 ans pour la valeur en dollars et la superposition au positionnement
        syms = {c: ("DX-Y.NYB" if c == "USD" else f"{c}USD=X" if c in ("EUR", "GBP", "AUD", "NZD") else f"USD{c}=X") for c in COT_MARKETS}
        sp = _spark(list(syms.values()), "5y")
        px = {c: list(zip(sp[s]["d"], sp[s]["c"])) for c, s in syms.items() if s in sp}

        def usd_per_unit(c: str, d: str) -> float | None:
            v = price_on(px.get(c, []), d)
            if v is None:
                return None
            if c == "USD":
                return v  # 1 000 $ × indice : notionnel en dollars = net × taille × indice
            return v if syms[c][3:6] == "USD" and syms[c][:3] == c else 1 / v

        out, agg = [], {}
        for code, c in codes.items():
            rows = tff.get(code) or []
            if len(rows) < 2:
                continue
            size = COT_MARKETS[c][1]
            leg_by = {r["date"]: r for r in leg.get(code, [])}
            nets = {k: [r[f"{k}_long"] - r[f"{k}_short"] for r in rows] for k in ("lev", "am", "dealer", "other", "small")}
            spec = [leg_by[r["date"]]["spec_long"] - leg_by[r["date"]]["spec_short"] if r["date"] in leg_by else None for r in rows]
            last = rows[-1]
            u = usd_per_unit(c, last["date"])
            idx = {k: rolling_index(nets[k], COT_LOOKBACK) for k in ("lev", "am")}
            hist = []
            for i, r in enumerate(rows[-COT_LOOKBACK:]):
                j = len(rows) - min(COT_LOOKBACK, len(rows)) + i
                ud = usd_per_unit(c, r["date"])
                pr = price_on(px.get(c, []), r["date"])
                hist.append({"date": r["date"], "lev": nets["lev"][j], "am": nets["am"][j], "dealer": nets["dealer"][j], "spec": spec[j], "oi": r["oi"],
                             "price": pr, "lev_idx": idx["lev"][j], "am_idx": idx["am"][j], "lev_usd": nets["lev"][j] * size * ud if ud else None, "am_usd": nets["am"][j] * size * ud if ud else None})
                if c != "USD" and ud:
                    a = agg.setdefault(r["date"], {"lev": 0.0, "am": 0.0, "n": 0})
                    a["lev"] -= nets["lev"][j] * size * ud  # long devise contre dollar = court dollar
                    a["am"] -= nets["am"][j] * size * ud
                    a["n"] += 1
            spec_clean = [x for x in spec if x is not None]
            lev_tot = last["lev_long"] + last["lev_short"]
            out.append({
                "ccy": c, "name": CCY[c][0], "market": last["market"], "date": last["date"], "contract_size": size,
                "pair": {"USD": "DXY", "EUR": "EURUSD", "GBP": "GBPUSD", "AUD": "AUDUSD", "NZD": "NZDUSD"}.get(c, f"USD{c}"),
                "inverted": c not in ("USD", "EUR", "GBP", "AUD", "NZD"),
                "oi": last["oi"], "oi_chg": last["oi_chg"],
                "lev": position_stats(nets["lev"], last["oi"]), "am": position_stats(nets["am"], last["oi"]),
                "dealer": position_stats(nets["dealer"], last["oi"]), "other": position_stats(nets["other"], last["oi"]),
                "small": position_stats(nets["small"], last["oi"]),
                "spec": position_stats(spec_clean, leg_by[last["date"]]["oi"]) if len(spec_clean) > 1 and last["date"] in leg_by else None,
                "lev_long_pct": last["lev_long"] / lev_tot * 100 if lev_tot else None,
                "traders_lev": [last["traders_lev_long"], last["traders_lev_short"]], "traders_am": [last["traders_am_long"], last["traders_am_short"]],
                "lev_usd": nets["lev"][-1] * size * u if u else None,
                "lev_chg_usd": (nets["lev"][-1] - nets["lev"][-2]) * size * u if u else None,
                "flip": (nets["lev"][-1] > 0) != (nets["lev"][-2] > 0), "am_usd": nets["am"][-1] * size * u if u else None,
                "history": hist,
            })
        if not out:
            raise SourceError("CFTC : aucun contrat de devise reçu")
        full = max(a["n"] for a in agg.values()) if agg else 0
        usd_agg = [{"date": d, "lev": a["lev"], "am": a["am"]} for d, a in sorted(agg.items()) if a["n"] == full]
        order = list(COT_MARKETS)
        return {"markets": sorted(out, key=lambda x: order.index(x["ccy"])), "usd_aggregate": usd_agg, "lookback_weeks": COT_LOOKBACK}
    return cached("fx:cot", 6 * 3600, "CFTC COT (TFF et legacy) · Yahoo Finance", fetch, status=HISTORICAL)


@router.get("/seasonality")
def fx_seasonality(pair: str, years: int = 15):
    pair = pair.upper().replace("/", "")
    if pair not in {p for p, _ in PAIRS}:
        raise HTTPException(404, f"Paire non suivie : {pair}")

    def fetch():
        h = prices.history(f"{pair}=X", "1mo", "max")
        return {"pair": pair, "years": years, "months": seasonality_from_monthly(h["candles"], years)}
    return cached(f"fx:season:{pair}:{years}", 86400, prices.name, fetch, status=HISTORICAL)
