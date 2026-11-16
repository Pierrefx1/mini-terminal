"""BCE : taux de change de référence quotidiens contre l'euro (sans clé)."""
import csv
import io

from ..cache import SourceError
from .http import get


class ECB:
    name = "BCE (taux de référence)"

    def rates(self, currency: str, start: str) -> list[list]:
        """[[date, unités de `currency` pour 1 EUR], ...] trié par date."""
        url = f"https://data-api.ecb.europa.eu/service/data/EXR/D.{currency}.EUR.SP00.A"
        r = get(url, params={"startPeriod": start, "format": "csvdata"})
        out = [[row["TIME_PERIOD"], float(row["OBS_VALUE"])] for row in csv.DictReader(io.StringIO(r.text)) if row.get("OBS_VALUE")]
        if not out:
            raise SourceError(f"BCE : pas de taux de change pour {currency}")
        return sorted(out)
