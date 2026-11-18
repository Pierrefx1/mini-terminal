"""WEI : vue globale des marchés mondiaux (indices, volatilité, carte des places, largeur de marché)."""
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter

from ..analytics import breadth, perf_stats
from ..cache import DELAYED, SourceError, cached
from ..providers.registry import prices
from . import screener

router = APIRouter(prefix="/api/overview", tags=["vue d'ensemble"])

# (région, symbole Yahoo, libellé, note)
MAIN = [
    ("Amériques", "^GSPC", "S&P 500", ""),
    ("Amériques", "^IXIC", "Nasdaq Composite", ""),
    ("Amériques", "^DJI", "Dow Jones Industrial", ""),
    ("Amériques", "^RUT", "Russell 2000", ""),
    ("Europe", "^STOXX50E", "Euro Stoxx 50", ""),
    ("Europe", "^FCHI", "CAC 40", ""),
    ("Europe", "^GDAXI", "DAX", ""),
    ("Europe", "^FTSE", "FTSE 100", ""),
    ("Asie", "^N225", "Nikkei 225", ""),
    ("Asie", "^HSI", "Hang Seng", ""),
    ("Monde", "URTH", "MSCI World", "Indice non diffusé gratuitement : ETF iShares MSCI World (URTH, en USD) utilisé comme approximation."),
    ("Volatilité", "^VIX", "VIX", ""),
]

# Carte des places : une tuile par indice, colorée selon la variation du jour.
HEAT = {
    "Amériques": [("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^DJI", "Dow Jones"), ("^RUT", "Russell 2000"),
                  ("^GSPTSE", "TSX"), ("^BVSP", "Bovespa"), ("^MXX", "IPC Mexique")],
    "Europe": [("^STOXX50E", "Euro Stoxx 50"), ("^STOXX", "Stoxx 600"), ("^FCHI", "CAC 40"), ("^GDAXI", "DAX"), ("^FTSE", "FTSE 100"),
               ("FTSEMIB.MI", "FTSE MIB"), ("^IBEX", "IBEX 35"), ("^AEX", "AEX"), ("^SSMI", "SMI")],
    "Asie-Pacifique": [("^N225", "Nikkei 225"), ("^HSI", "Hang Seng"), ("000001.SS", "Shanghai Comp."), ("^KS11", "KOSPI"),
                       ("^TWII", "Taiwan"), ("^NSEI", "Nifty 50"), ("^AXJO", "ASX 200")],
}

# Structure par terme de la volatilité implicite du S&P 500 (CBOE)
VOL = [("^VIX9D", "VIX 9 jours"), ("^VIX", "VIX 30 jours"), ("^VIX3M", "VIX 3 mois"), ("^VIX6M", "VIX 6 mois"), ("^VVIX", "Vol. du VIX (VVIX)")]


def _row(region: str, symbol: str, label: str, note: str) -> dict:
    try:
        d = prices.describe(symbol)
    except Exception as e:
        return {"region": region, "symbol": symbol, "label": label, "note": note, "error": str(e)}
    return {"region": region, "symbol": symbol, "label": label, "note": note, "currency": d["currency"], "type": d["type"],
            "exchange": d["exchange"], "time": d["time"], "day_high": d["day_high"], "day_low": d["day_low"],
            **perf_stats(d["candles"], d["price"], d["gmtoffset"]),
            "spark": [c["close"] for c in d["candles"][-60:]]}


def _main() -> list[dict]:
    with ThreadPoolExecutor(6) as ex:
        rows = list(ex.map(lambda a: _row(*a), MAIN))
    if all("error" in r for r in rows):  # ne jamais mettre en cache un échec total
        raise SourceError(rows[0]["error"])
    return rows


@router.get("/indices")
def indices():
    return cached("wei:indices", 120, prices.name, _main, status=DELAYED)


@router.get("/heatmap")
def heatmap():
    syms = [s for group in HEAT.values() for s, _ in group]

    def fetch():
        q = {x["symbol"]: x for x in prices.quotes(syms)}
        return [{"region": reg, "tiles": [{"symbol": s, "label": lab, **{k: q.get(s, {}).get(k) for k in ("price", "change_pct", "time", "error")}}
                                          for s, lab in group]} for reg, group in HEAT.items()]
    return cached("wei:heatmap", 120, prices.name, fetch, status=DELAYED)


@router.get("/volatility")
def volatility():
    def fetch():
        q = {x["symbol"]: x for x in prices.quotes([s for s, _ in VOL])}
        return [{"symbol": s, "label": lab, **{k: q.get(s, {}).get(k) for k in ("price", "change", "change_pct", "time", "error")}} for s, lab in VOL]
    return cached("wei:vol", 120, prices.name, fetch, status=DELAYED)


@router.get("/breadth")
def market_breadth():
    """Largeur du S&P 500, calculée sur les cours du screener."""
    s = screener.screener("sp500")
    rows = s["data"]["rows"]
    out = {k: breadth([r.get(k) for r in rows]) for k in ("d1", "w1", "m1", "ytd")}
    by_sector: dict[str, list] = {}
    for r in rows:
        by_sector.setdefault(r.get("sector") or "Autre", []).append(r.get("d1"))
    out["sectors"] = sorted(({"sector": k, **breadth(v)} for k, v in by_sector.items()), key=lambda x: -(x["median"] or -1e9))
    return {"data": out, "source": s["source"], "status": DELAYED, "fetched_at": s["fetched_at"], "stale": s["stale"], "error": s["error"]}


@router.get("/describe")
def describe(symbol: str):
    """DES : fiche d'un instrument (métadonnées, statistiques sur un an, cours quotidiens)."""
    def fetch():
        d = prices.describe(symbol)
        return {**{k: v for k, v in d.items() if k != "candles"}, **perf_stats(d["candles"], d["price"], d["gmtoffset"]),
                "closes": [{"time": c["time"], "close": c["close"]} for c in d["candles"]]}
    return cached(f"des:{symbol.upper()}", 120, prices.name, fetch, status=DELAYED)
