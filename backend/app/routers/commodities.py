"""Module matières premières : tableau de bord, courbes à terme, spreads, saisonnalité, stocks EIA, positionnement CFTC."""
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import statistics

from fastapi import APIRouter, HTTPException

from ..analytics import perf_stats
from ..cache import DELAYED, HISTORICAL, SourceError, cached
from ..providers.eia import SERIES as EIA_SERIES
from ..providers.registry import cot, inventories, prices

router = APIRouter(prefix="/api/commodities", tags=["matières premières"])
MONTHS = "FGHJKMNQUVXZ"

# clé: (groupe, libellé, symbole front, unité, place, racine des contrats, suffixe, mois cotés, taille du contrat, code CFTC)
C = {
    "BRENT": ("Énergie", "Brent", "BZ=F", "$/baril", "NYMEX (Brent dernier jour)", "BZ", "NYM", MONTHS, 1000, "06765T"),
    "WTI": ("Énergie", "WTI", "CL=F", "$/baril", "NYMEX", "CL", "NYM", MONTHS, 1000, "067651"),
    "NG": ("Énergie", "Gaz naturel Henry Hub", "NG=F", "$/MMBtu", "NYMEX", "NG", "NYM", MONTHS, 10000, "023651"),
    "TTF": ("Énergie", "Gaz TTF (Pays-Bas)", "TTF=F", "€/MWh", "ICE Endex", None, None, None, None, None),
    "HO": ("Énergie", "Diesel ULSD (proxy gasoil)", "HO=F", "$/gallon", "NYMEX", "HO", "NYM", MONTHS, 42000, "022651"),
    "RB": ("Énergie", "Essence RBOB", "RB=F", "$/gallon", "NYMEX", "RB", "NYM", MONTHS, 42000, "111659"),
    "GC": ("Métaux", "Or", "GC=F", "$/once", "COMEX", "GC", "CMX", "GJMQVZ", 100, "088691"),
    "SI": ("Métaux", "Argent", "SI=F", "$/once", "COMEX", "SI", "CMX", "HKNUZ", 5000, "084691"),
    "HG": ("Métaux", "Cuivre", "HG=F", "$/livre", "COMEX", "HG", "CMX", "HKNUZ", 25000, "085692"),
    "ALI": ("Métaux", "Aluminium", "ALI=F", "$/tonne", "COMEX", None, None, None, None, None),
    "PL": ("Métaux", "Platine", "PL=F", "$/once", "NYMEX", "PL", "NYM", "FJNV", 50, "076651"),
    "PA": ("Métaux", "Palladium", "PA=F", "$/once", "NYMEX", "PA", "NYM", "HMUZ", 100, "075651"),
    "ZW": ("Agriculture", "Blé (SRW)", "ZW=F", "¢/boisseau", "CBOT", "ZW", "CBT", "HKNUZ", 5000, "001602"),
    "ZC": ("Agriculture", "Maïs", "ZC=F", "¢/boisseau", "CBOT", "ZC", "CBT", "HKNUZ", 5000, "002602"),
    "ZS": ("Agriculture", "Soja", "ZS=F", "¢/boisseau", "CBOT", "ZS", "CBT", "FHKNQUX", 5000, "005602"),
    "ZM": ("Agriculture", "Tourteau de soja", "ZM=F", "$/tonne courte", "CBOT", None, None, None, None, None),
    "ZL": ("Agriculture", "Huile de soja", "ZL=F", "¢/livre", "CBOT", None, None, None, None, None),
    "KC": ("Agriculture", "Café arabica", "KC=F", "¢/livre", "ICE US", "KC", "NYB", "HKNUZ", 37500, "083731"),
    "CC": ("Agriculture", "Cacao", "CC=F", "$/tonne", "ICE US", "CC", "NYB", "HKNUZ", 10, "073732"),
    "SB": ("Agriculture", "Sucre n° 11", "SB=F", "¢/livre", "ICE US", "SB", "NYB", "HKNV", 112000, "080732"),
    "CT": ("Agriculture", "Coton", "CT=F", "¢/livre", "ICE US", "CT", "NYB", "HKNVZ", 50000, "033661"),
}
# Demandés mais sans source gratuite fiable : affichés comme tels, jamais simulés.
UNAVAILABLE = [
    ("Énergie", "Électricité (EEX, Nord Pool)", "prix sous licence des bourses d'électricité"),
    ("Énergie", "Charbon (API2 Rotterdam)", "contrat ICE sous licence"),
    ("Énergie", "Gasoil ICE", "contrat ICE sous licence ; le diesel ULSD du NYMEX sert d'approximation"),
    ("Métaux", "Nickel (LME)", "données LME sous licence"),
    ("Métaux", "Zinc (LME)", "données LME sous licence"),
]


def _cfg(key: str):
    if key not in C:
        raise HTTPException(404, f"Matière première inconnue : {key}")
    return C[key]


def _closes_stats(t: list[int], c: list[float]) -> dict:
    candles = [{"time": a, "open": b, "high": b, "low": b, "close": b, "volume": 0} for a, b in zip(t, c)]
    return perf_stats(candles)


@router.get("/board")
def board():
    def fetch():
        syms = [v[2] for v in C.values()]
        spark: dict = {}
        for i in range(0, len(syms), 20):
            spark.update(prices.spark(syms[i:i + 20], "1y", "1d"))
        if not spark:
            raise SourceError("Yahoo : aucune série reçue")
        rows = []
        for k, v in C.items():
            s = spark.get(v[2])
            base = {"key": k, "group": v[0], "name": v[1], "symbol": v[2], "unit": v[3], "exchange": v[4], "curve": v[5] is not None, "cot": v[9]}
            if not s:
                rows.append({**base, "error": "pas de cours reçu"})
                continue
            st = _closes_stats(s["t"], s["c"])
            rows.append({**base, **{k2: st.get(k2) for k2 in ("last", "d1", "w1", "m1", "ytd", "hi52", "lo52", "range_pos", "vol20")}, "spark": s["c"][-60:]})
        return {"rows": rows, "unavailable": [{"group": g, "name": n, "reason": r} for g, n, r in UNAVAILABLE]}
    return cached("cmdty:board", 300, prices.name, fetch, status=DELAYED)


def _nth_weekday(y: int, m: int, wd: int, n: int) -> date:
    """n-ième jour de semaine wd (0 = lundi) du mois ; n = -1 pour le dernier."""
    if n > 0:
        d = date(y, m, 1)
        d += timedelta(days=(wd - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)
    d = _month_end(y, m)
    return d - timedelta(days=(d.weekday() - wd) % 7)


def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = b // 4, b % 4
    g = (8 * b + 13) // 25
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7  # noqa: E741
    m = (a + 11 * h + 19 * l) // 433
    month = (h + l - 7 * m + 90) // 25
    return date(y, month, (h + l - 7 * m + 33 * month + 19) % 32)


def _observed(d: date) -> date:
    return d - timedelta(days=1) if d.weekday() == 5 else d + timedelta(days=1) if d.weekday() == 6 else d


def us_holidays(y: int) -> set[date]:
    """Jours fériés des bourses américaines (NYSE, CME, ICE US)."""
    return {_observed(date(y, 1, 1)), _nth_weekday(y, 1, 0, 3), _nth_weekday(y, 2, 0, 3), _easter(y) - timedelta(days=2),
            _nth_weekday(y, 5, 0, -1), _observed(date(y, 6, 19)), _observed(date(y, 7, 4)), _nth_weekday(y, 9, 0, 1),
            _nth_weekday(y, 11, 3, 4), _observed(date(y, 12, 25))}


def _open(d: date) -> bool:
    return d.weekday() < 5 and d not in us_holidays(d.year)


def _bday(d: date, back: int = 0) -> date:
    """Jour ouvré de bourse : d s'il est ouvré (sinon le précédent), puis `back` jours ouvrés avant."""
    while not _open(d):
        d -= timedelta(days=1)
    while back:
        d -= timedelta(days=1)
        if _open(d):
            back -= 1
    return d


def _month_end(y: int, m: int) -> date:
    return (date(y + m // 12, m % 12 + 1, 1) - timedelta(days=1))


def _prev_month(y: int, m: int, k: int = 1) -> tuple[int, int]:
    i = y * 12 + (m - 1) - k
    return i // 12, i % 12 + 1


def last_trade(root: str, y: int, m: int) -> date:
    """Dernier jour de cotation estimé d'un contrat (règles des bourses, sans jours fériés)."""
    if root == "CL":   # 3 jours ouvrés avant le 25 du mois précédant la livraison
        py, pm = _prev_month(y, m)
        return _bday(date(py, pm, 25), 3)  # 25 non ouvré : on part du jour ouvré précédent
    if root == "NG":   # 3 jours ouvrés avant le premier jour du mois de livraison
        return _bday(date(y, m, 1) - timedelta(days=1), 2)
    if root in ("HO", "RB", "SB"):  # dernier jour ouvré du mois précédent
        return _bday(_month_end(*_prev_month(y, m)))
    if root == "BZ":   # dernier jour ouvré du deuxième mois précédant la livraison
        return _bday(_month_end(*_prev_month(y, m, 2)))
    if root in ("GC", "SI", "HG", "PL", "PA"):  # troisième avant-dernier jour ouvré du mois de livraison
        return _bday(_month_end(y, m), 2)
    if root in ("ZC", "ZW", "ZS"):  # jour ouvré précédant le 15 du mois de livraison
        return _bday(date(y, m, 14))
    if root == "KC":
        return _bday(_month_end(y, m), 8)
    if root == "CC":
        return _bday(_month_end(y, m), 11)
    if root == "CT":
        return _bday(_month_end(y, m), 17)
    return _month_end(y, m)


def contract_symbols(key: str, today: date | None = None, count: int = 14) -> list[tuple[str, str, int]]:
    """Contrats à venir : (symbole Yahoo, échéance AAAA-MM, mois depuis aujourd'hui)."""
    _, _, _, _, _, root, suffix, months, *_ = _cfg(key)
    if not root:
        return []
    today = today or date.today()
    out, y, m = [], today.year, today.month
    for i in range(48):
        mm, yy = (m - 1 + i) % 12 + 1, y + (m - 1 + i) // 12
        code = MONTHS[mm - 1]
        if code in months:
            out.append((f"{root}{code}{yy % 100:02d}.{suffix}", f"{yy}-{mm:02d}", i))
        if len(out) >= count:
            break
    return out


def curve_metrics(pts: list[dict]) -> dict:
    """Structure de la courbe : spreads, pente, rendement de roulement annualisé entre les deux premiers contrats."""
    if len(pts) < 2:
        return {}
    f1, f2, fl = pts[0], pts[1], pts[-1]
    months12 = next((p for p in pts if p["months"] - f1["months"] >= 11), fl)
    dm = max(f2["months"] - f1["months"], 1)
    roll = (f1["price"] / f2["price"] - 1) * 12 / dm * 100
    shape = "backwardation" if f1["price"] > months12["price"] else "contango" if f1["price"] < months12["price"] else "plate"
    return {"shape": shape, "m1_m2": f1["price"] - f2["price"], "m1_m12": f1["price"] - months12["price"], "m12_label": months12["expiry"],
            "slope_pct": (months12["price"] / f1["price"] - 1) * 100, "roll_yield_pct": roll}


@router.get("/curve")
def curve(key: str):
    cfg = _cfg(key)
    if not cfg[5]:
        raise HTTPException(404, f"{cfg[1]} : pas de contrats par échéance disponibles gratuitement")

    def fetch():
        cands = contract_symbols(key)
        q = {x["symbol"]: x for x in prices.quotes([s for s, _, _ in cands])}
        now = datetime.now(timezone.utc).timestamp()
        pts = []
        today = date.today()
        for sym, exp, months in cands:
            x = q.get(sym) or {}
            lt = last_trade(cfg[5], int(exp[:4]), int(exp[5:]))
            days = sum(1 for i in range((lt - today).days) if _open(today + timedelta(days=i + 1)))
            # contrat échu, ou sans cotation depuis 10 jours (illiquide) : écarté
            if lt >= today and x.get("price") and x.get("time") and now - x["time"] < 10 * 86400:
                pts.append({"symbol": sym, "expiry": exp, "months": months, "price": x["price"], "change_pct": x.get("change_pct"), "time": x["time"],
                            "last_trade": lt.isoformat(), "days_left": days, "expiring": days < 5})
        active = [p for p in pts if not p["expiring"]]
        if len(active) < 2:
            raise SourceError(f"Yahoo : courbe {cfg[1]} indisponible (moins de deux contrats actifs cotés)")
        return {"key": key, "name": cfg[1], "unit": cfg[3], "exchange": cfg[4], "contract_size": cfg[8], "points": pts, **curve_metrics(active),
                "expiry_note": "Dates d'expiration calculées selon les règles de la bourse et le calendrier des jours fériés américains. Structure mesurée à partir du premier contrat à plus de 5 jours ouvrés de l'expiration."}
    return cached(f"cmdty:curve:{key}", 300, prices.name, fetch, status=DELAYED)


@router.get("/spread")
def calendar_spread(a: str, b: str, range_: str = "6mo"):
    """Historique d'un spread calendaire entre deux contrats (a − b)."""
    def fetch():
        ha, hb = prices.history(a, "1d", range_), prices.history(b, "1d", range_)
        day = lambda t: datetime.fromtimestamp(t, timezone.utc).date().isoformat()  # noqa: E731
        ca = {day(c["time"]): c["close"] for c in ha["candles"]}
        cb = {day(c["time"]): c["close"] for c in hb["candles"]}
        rows = [{"date": d, "a": ca[d], "b": cb[d], "spread": ca[d] - cb[d]} for d in sorted(set(ca) & set(cb))]
        if not rows:
            raise SourceError("Pas de dates communes entre les deux contrats")
        return {"a": a, "b": b, "rows": rows}
    return cached(f"cmdty:spread:{a}:{b}:{range_}", 900, prices.name, fetch, status=DELAYED)


def seasonality_from_monthly(candles: list[dict], years: int = 15) -> list[dict]:
    """Rendement moyen et fréquence de hausse par mois calendaire, sur les `years` dernières années."""
    closes = [(datetime.fromtimestamp(c["time"], timezone.utc), c["close"]) for c in candles]
    cutoff = closes[-1][0].year - years if closes else 0
    by = defaultdict(list)
    for (d0, c0), (d1, c1) in zip(closes, closes[1:]):
        if d1.year > cutoff and c0:
            by[d1.month].append((c1 / c0 - 1) * 100)
    return [{"month": m, "avg": statistics.mean(by[m]) if by[m] else None, "median": statistics.median(by[m]) if by[m] else None,
             "hit": sum(r > 0 for r in by[m]) / len(by[m]) * 100 if by[m] else None, "n": len(by[m])} for m in range(1, 13)]


@router.get("/seasonality")
def seasonality(key: str, years: int = 15):
    cfg = _cfg(key)

    def fetch():
        h = prices.history(cfg[2], "1mo", "max")
        return {"key": key, "name": cfg[1], "years": years, "months": seasonality_from_monthly(h["candles"], years)}
    return cached(f"cmdty:season:{key}:{years}", 86400, prices.name, fetch, status=HISTORICAL)


def vs_five_year(points: list[dict]) -> dict:
    """Dernier relevé comparé à la moyenne et à la fourchette des 5 années précédentes à la même semaine."""
    if not points:
        return {}
    last = points[-1]
    d = date.fromisoformat(last["date"])
    wk = d.isocalendar()[1]
    same = [p["value"] for p in points if date.fromisoformat(p["date"]).year in range(d.year - 5, d.year)
            and abs(date.fromisoformat(p["date"]).isocalendar()[1] - wk) <= 0]
    prev = points[-2]["value"] if len(points) > 1 else None
    avg = statistics.mean(same) if same else None
    return {"last": last["value"], "date": last["date"], "change": last["value"] - prev if prev is not None else None,
            "avg5": avg, "min5": min(same) if same else None, "max5": max(same) if same else None,
            "vs_avg5_pct": (last["value"] / avg - 1) * 100 if avg else None}


@router.get("/inventories")
def eia_inventories():
    def fetch():
        allv = inventories.all()
        return [{**{x: s[x] for x in ("key", "id", "label", "unit")}, **vs_five_year(s["points"]), "points": s["points"][-156:]}
                if s["points"] else {"key": k, "label": EIA_SERIES[k][1], "error": "série vide"} for k, s in allv.items()]
    return cached("cmdty:eia", 6 * 3600, inventories.name, fetch, status=HISTORICAL)


def cot_metrics(rows: list[dict], lookback: int = 156) -> dict:
    """Position nette des spéculateurs (non commerciaux) et indice COT : position dans la fourchette sur 3 ans (0 à 100)."""
    nets = [r["spec_long"] - r["spec_short"] for r in rows]
    window = nets[-lookback:]
    last = nets[-1]
    lo, hi = min(window), max(window)
    z = (last - statistics.mean(window)) / statistics.stdev(window) if len(window) > 2 and statistics.stdev(window) else None
    return {"net_spec": last, "net_spec_change": last - nets[-2] if len(nets) > 1 else None,
            "net_comm": rows[-1]["comm_long"] - rows[-1]["comm_short"], "cot_index": (last - lo) / (hi - lo) * 100 if hi > lo else None,
            "zscore": z, "spec_pct_oi": last / rows[-1]["oi"] * 100 if rows[-1]["oi"] else None}


@router.get("/cot")
def positioning(key: str):
    cfg = _cfg(key)
    if not cfg[9]:
        raise HTTPException(404, f"{cfg[1]} : pas de rapport CFTC (contrat hors juridiction américaine)")

    def fetch():
        rows = cot.history(cfg[9])
        return {"key": key, "name": cfg[1], "market": rows[-1]["market"], **cot_metrics(rows),
                "rows": [{"date": r["date"], "net_spec": r["spec_long"] - r["spec_short"], "net_comm": r["comm_long"] - r["comm_short"], "oi": r["oi"]} for r in rows]}
    return cached(f"cmdty:cot:{key}", 12 * 3600, cot.name, fetch, status=HISTORICAL)


@router.get("/catalog")
def catalog():
    return {"data": [{"key": k, "group": v[0], "name": v[1], "symbol": v[2], "unit": v[3], "exchange": v[4], "curve": v[5] is not None,
                      "cot": v[9] is not None, "contract_size": v[8]} for k, v in C.items()],
            "source": "configuration", "status": None, "fetched_at": None, "stale": False, "error": None}
