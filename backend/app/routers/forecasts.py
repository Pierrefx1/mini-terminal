"""Données prévues : prévisions OCDE, projections de la Fed, trajectoire de taux anticipée par le marché."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date

from fastapi import APIRouter, HTTPException

from ..cache import SourceError, cached
from ..providers.oecd import MEASURES, OECD
from ..providers.registry import macro, policy, prices

router = APIRouter(prefix="/api/forecasts", tags=["forecasts"])
oecd = OECD()
AREAS = {"USA": "États-Unis", "EA20": "Zone euro", "FRA": "France", "DEU": "Allemagne", "ITA": "Italie", "ESP": "Espagne", "GBR": "Royaume-Uni", "JPN": "Japon",
         "CHN": "Chine", "IND": "Inde", "CAN": "Canada", "AUS": "Australie", "KOR": "Corée du Sud", "BRA": "Brésil", "MEX": "Mexique", "CHE": "Suisse",
         "SWE": "Suède", "NLD": "Pays-Bas", "BEL": "Belgique", "POL": "Pologne", "TUR": "Turquie", "OECD": "OCDE (total)", "W": "Monde"}
SEP = [("FEDTARMD", "Taux des Fed funds (médiane)"), ("GDPC1MD", "Croissance du PIB réel (médiane)"), ("UNRATEMD", "Taux de chômage (médiane)"),
       ("PCECTPIMD", "Inflation PCE (médiane)"), ("JCXFEMD", "Inflation PCE sous-jacente (médiane)")]
MONTHS = "FGHJKMNQUVXZ"  # codes de mois des contrats à terme


@router.get("/outlook")
def outlook(area: str = "FRA"):
    e = cached("oecd:eo", 24 * 3600, oecd.name, oecd.outlook)
    if area not in e["data"]:
        raise HTTPException(404, detail={"source": oecd.name, "error": f"Zone {area} absente des Perspectives économiques"})
    this = date.today().year
    rows = []
    for code, (label, unit) in MEASURES.items():
        obs = e["data"][area].get(code)
        if not obs:
            continue
        actual = [o for o in obs if o[0] < this]
        rows.append({"code": code, "label": label, "unit": unit, "obs": obs, "last_actual": actual[-1] if actual else None,
                     "forecasts": [o for o in obs if o[0] >= this]})
    areas = [{"code": a, "name": n} for a, n in AREAS.items() if a in e["data"]]
    return {"data": {"area": AREAS.get(area, area), "areas": areas, "first_forecast_year": this, "rows": rows},
            "source": e["source"], "fetched_at": e["fetched_at"], "stale": e["stale"], "error": e["error"]}


@router.get("/fed")
def fed():
    """Projections économiques de la Fed (SEP), médianes par année."""
    def build():
        return [{"id": sid, "label": label, **{k: v for k, v in macro.series(sid).items() if k in ("obs", "last_updated")}} for sid, label in SEP]
    return cached("fred:sep", 12 * 3600, macro.name, build)


@router.get("/rates")
def rates():
    """Taux Fed funds moyen anticipé par mois = 100 - cours du contrat à terme 30 jours."""
    def build():
        today = date.today()
        contracts = []
        for k in range(0, 14):
            y, m = today.year + (today.month - 1 + k) // 12, (today.month - 1 + k) % 12 + 1
            contracts.append((f"ZQ{MONTHS[m - 1]}{y % 100:02d}.CBT", f"{y}-{m:02d}"))
        def one(c):
            try:
                q = prices.quote(c[0])
                return {"contract": c[0], "month": c[1], "price": q["price"], "implied": round(100 - q["price"], 4)} if q.get("price") else None
            except Exception:
                return None
        with ThreadPoolExecutor(4) as ex:
            out = [x for x in ex.map(one, contracts) if x]
        if len(out) < 3:
            raise SourceError("Contrats Fed funds indisponibles")
        try:
            us = next(b for b in cached("policy", 6 * 3600, policy.name, policy.policy_rates)["data"]["banks"] if b["area"] == "US")
            current = {"rate": us["rate"], "date": us["date"]}
        except Exception:
            current = None
        return {"path": out, "current": current}
    return cached("ffr:path", 1800, f"{prices.name} · contrats CBOT 30-Day Fed Funds", build)
