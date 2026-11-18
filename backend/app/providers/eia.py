"""EIA (U.S. Energy Information Administration) : stocks et production hebdomadaires, domaine public.
Clé gratuite dans EIA_API_KEY (inscription sur eia.gov/opendata) ; à défaut, la clé de démonstration publique, au quota très réduit."""
import httpx

from .. import config
from ..cache import SourceError
from .http import get

SERIES = {
    "crude": ("WCESTUS1", "Brut, stocks commerciaux (hors SPR)", "Mbbl"),
    "cushing": ("W_EPC0_SAX_YCUOK_MBBL", "Brut, stocks à Cushing (Oklahoma)", "Mbbl"),
    "spr": ("WCSSTUS1", "Réserve stratégique (SPR)", "Mbbl"),
    "gasoline": ("WGTSTUS1", "Essence, stocks totaux", "Mbbl"),
    "distillate": ("WDISTUS1", "Distillats (diesel, fioul), stocks", "Mbbl"),
    "production": ("WCRFPUS2", "Production de brut US", "Mbbl/j"),
    "refinery": ("WPULEUS3", "Taux d'utilisation des raffineries", "%"),
    "natgas": ("NW2_EPG0_SWO_R48_BCF", "Gaz naturel en stockage souterrain (48 États)", "Bcf"),
}
# Les stocks pétroliers partagent une même route : un seul appel pour cinq séries.
STOCKS = ["crude", "cushing", "spr", "gasoline", "distillate"]
SINGLE = {"production": "PET.WCRFPUS2.W", "refinery": "PET.WPULEUS3.W", "natgas": "NG.NW2_EPG0_SWO_R48_BCF.W"}


class EIA:
    name = "EIA (hebdomadaire)"

    def _get(self, url: str, params: dict) -> list[dict]:
        try:
            j = get(url, params={"api_key": config.EIA_API_KEY or "DEMO_KEY", "sort[0][column]": "period", "sort[0][direction]": "desc", **params}).json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise SourceError("EIA : quota atteint" + ("" if config.EIA_API_KEY else " pour la clé de démonstration publique. "
                                  "Clé gratuite sur eia.gov/opendata, à mettre dans EIA_API_KEY (.env)."))
            raise
        data = j.get("response", {}).get("data") or []
        if not data:
            raise SourceError(f"EIA : réponse vide ({j.get('error') or 'série introuvable'})")
        return data

    def all(self, weeks: int = 320) -> dict[str, dict]:
        out: dict[str, list] = {k: [] for k in SERIES}
        code_to_key = {SERIES[k][0]: k for k in STOCKS}
        rows = self._get("https://api.eia.gov/v2/petroleum/stoc/wstk/data/",
                         {"frequency": "weekly", "data[0]": "value", "length": weeks * len(STOCKS), **{f"facets[series][{i}]": SERIES[k][0] for i, k in enumerate(STOCKS)}})
        for r in rows:
            k = code_to_key.get(r.get("series"))
            if k and r.get("value") not in (None, ""):
                out[k].append({"date": r["period"], "value": float(r["value"])})
        for k, sid in SINGLE.items():
            for r in self._get(f"https://api.eia.gov/v2/seriesid/{sid}", {"length": weeks}):
                if r.get("value") not in (None, ""):
                    out[k].append({"date": r["period"], "value": float(r["value"])})
        return {k: {"key": k, "id": SERIES[k][0], "label": SERIES[k][1], "unit": SERIES[k][2], "points": sorted(v, key=lambda x: x["date"])}
                for k, v in out.items()}
