"""Trésor américain : courbes de taux quotidiennes, nominales et réelles (sans clé)."""
import csv
import io
from datetime import datetime

from ..cache import SourceError
from .http import get

URL = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/"
       "{year}/all?type={kind}&field_tdr_date_value={year}&page&_format=csv")
KINDS = {"nominal": "daily_treasury_yield_curve", "real": "daily_treasury_real_yield_curve"}
LABELS = {"1 Mo": "1M", "1.5 Month": "6S", "2 Mo": "2M", "3 Mo": "3M", "4 Mo": "4M", "6 Mo": "6M", "1 Yr": "1A", "2 Yr": "2A",
          "3 Yr": "3A", "5 Yr": "5A", "7 Yr": "7A", "10 Yr": "10A", "20 Yr": "20A", "30 Yr": "30A",
          "5 YR": "5A", "7 YR": "7A", "10 YR": "10A", "20 YR": "20A", "30 YR": "30A"}


class Treasury:
    name = "U.S. Treasury"

    def year(self, kind: str, year: int) -> list[dict]:
        text = get(URL.format(year=year, kind=KINDS[kind])).text
        rows = list(csv.DictReader(io.StringIO(text)))
        if not rows or "Date" not in rows[0]:
            raise SourceError(f"Treasury : réponse inattendue pour {kind} {year}")
        out = []
        for r in rows:
            d = datetime.strptime(r["Date"], "%m/%d/%Y").date().isoformat()
            vals = {LABELS.get(k, k): (float(v) if v not in ("", "N/A", None) else None) for k, v in r.items() if k != "Date"}
            out.append({"date": d, **vals})
        return sorted(out, key=lambda x: x["date"])
