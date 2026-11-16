"""FRED (Fed de Saint-Louis) : API officielle, clé gratuite requise."""
from .. import config
from ..cache import SourceError
from .http import get

API = "https://api.stlouisfed.org/fred"


class Fred:
    name = "FRED"

    def _get(self, path: str, **params) -> dict:
        if not config.FRED_API_KEY:
            raise SourceError("Clé FRED manquante : renseigner FRED_API_KEY dans le fichier .env (clé gratuite sur fred.stlouisfed.org).")
        return get(f"{API}/{path}", params={**params, "api_key": config.FRED_API_KEY, "file_type": "json"}).json()

    def series(self, series_id: str, start: str | None = None, units: str = "lin") -> dict:
        meta = self._get("series", series_id=series_id)["seriess"][0]
        p = {"series_id": series_id, "units": units}
        if start:
            p["observation_start"] = start
        obs = self._get("series/observations", **p)["observations"]
        return {"id": series_id, "title": meta["title"], "frequency": meta["frequency_short"], "units": meta["units_short"],
                "transform": units, "last_updated": meta["last_updated"],
                "obs": [[o["date"], float(o["value"])] for o in obs if o["value"] != "."]}
