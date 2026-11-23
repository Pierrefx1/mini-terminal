"""Fixed Income : courbes souveraines, crédit, inflation. Le forex est dans routers/fx.py."""
import csv
import io
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter

from .. import config
from ..cache import HISTORICAL, SourceError, cached
from ..providers.http import get
from ..providers.registry import macro
from . import macro as macro_router

router = APIRouter(prefix="/api", tags=["taux et change"])

ECB_TENORS = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "15Y", "20Y", "30Y"]
TENOR_YEARS = {"1M": 1 / 12, "2M": 2 / 12, "3M": 0.25, "4M": 4 / 12, "6M": 0.5, "1Y": 1, "1A": 1, "2Y": 2, "2A": 2, "3Y": 3, "3A": 3, "5Y": 5, "5A": 5,
               "7Y": 7, "7A": 7, "10Y": 10, "10A": 10, "15Y": 15, "20Y": 20, "20A": 20, "30Y": 30, "30A": 30}

# Rendements à 10 ans publiés par l'OCDE via FRED (moyennes mensuelles)
SOVEREIGN_10Y = {"États-Unis": "IRLTLT01USM156N", "Allemagne (Bund)": "IRLTLT01DEM156N", "France (OAT)": "IRLTLT01FRM156N",
                 "Royaume-Uni (Gilt)": "IRLTLT01GBM156N", "Italie (BTP)": "IRLTLT01ITM156N", "Espagne (Bono)": "IRLTLT01ESM156N", "Japon (JGB)": "IRLTLT01JPM156N"}
# Spreads de crédit ICE BofA (OAS, en points de pourcentage) et inflation, via FRED
CREDIT = {"IG US (OAS)": "BAMLC0A0CM", "BBB US (OAS)": "BAMLC0A4CBBB", "High Yield US (OAS)": "BAMLH0A0HYM2", "High Yield euro (OAS)": "BAMLHE00EHYIOAS"}
INFLATION = {"Point mort d'inflation 10 ans US": "T10YIE", "Point mort 5 ans US": "T5YIE", "Taux réel 10 ans US (TIPS)": "DFII10"}


def _ecb_curve() -> dict:
    keys = "+".join(f"SR_{t}" for t in ECB_TENORS)
    text = get(f"https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.{keys}", params={"format": "csvdata", "lastNObservations": 6}).text
    by: dict[str, list] = {}
    for r in csv.DictReader(io.StringIO(text)):
        by.setdefault(r["DATA_TYPE_FM"].replace("SR_", ""), []).append((r["TIME_PERIOD"], float(r["OBS_VALUE"])))
    if not by:
        raise SourceError("BCE : courbe des taux vide")
    last_date = max(v[-1][0] for v in by.values())
    pts = [{"tenor": t, "years": TENOR_YEARS[t], "rate": by[t][-1][1], "prev": by[t][-2][1] if len(by[t]) > 1 else None} for t in ECB_TENORS if t in by]
    return {"name": "Zone euro, émetteurs AAA (BCE)", "date": last_date, "points": pts}


@router.get("/rates/curves")
def curves():
    """Courbes souveraines du jour : Trésor américain (nominal et réel) et zone euro AAA (BCE, proche de la courbe Bund)."""
    def fetch():
        y = macro_router.yields(1)["data"]
        out = []
        for kind, label in (("nominal", "États-Unis, Trésor (nominal)"), ("real", "États-Unis, Trésor (réel, TIPS)")):
            rows = y.get(kind) or []
            if len(rows) >= 2:
                last, prev = rows[-1], rows[-2]
                out.append({"name": label, "date": last["date"], "points": [{"tenor": k, "years": TENOR_YEARS.get(k), "rate": v, "prev": prev.get(k)}
                                                                           for k, v in last.items() if k != "date" and v is not None and TENOR_YEARS.get(k)]})
        try:
            out.append(_ecb_curve())
        except Exception as e:
            out.append({"name": "Zone euro AAA (BCE)", "error": str(e), "points": []})
        return out
    return cached("rates:curves", 3600, "U.S. Treasury, BCE", fetch, status=HISTORICAL)


def _fred_block(series: dict[str, str], start: str) -> list[dict]:
    if not config.FRED_API_KEY:
        raise SourceError("Clé FRED absente : renseigner FRED_API_KEY dans .env")

    def one(item):
        label, sid = item
        try:
            s = macro.series(sid, start)
            obs = s["obs"]
            return {"label": label, "id": sid, "frequency": s["frequency"], "last": obs[-1][1], "date": obs[-1][0],
                    "prev": obs[-2][1] if len(obs) > 1 else None, "year_ago": next((v for d, v in reversed(obs) if d <= f"{int(obs[-1][0][:4]) - 1}{obs[-1][0][4:]}"), None),
                    "obs": obs[-520:]}
        except Exception as e:
            return {"label": label, "id": sid, "error": str(e)}
    with ThreadPoolExecutor(4) as ex:
        return list(ex.map(one, series.items()))


@router.get("/rates/sovereign")
def sovereign():
    return cached("rates:sov10", 6 * 3600, "OCDE via FRED (mensuel)", lambda: _fred_block(SOVEREIGN_10Y, "2015-01-01"), status=HISTORICAL)


@router.get("/rates/credit")
def credit():
    return cached("rates:credit", 6 * 3600, "ICE BofA et Fed via FRED", lambda: _fred_block({**CREDIT, **INFLATION}, "2018-01-01"), status=HISTORICAL)
