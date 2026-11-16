"""OCDE : Perspectives économiques (Economic Outlook), historique et prévisions annuelles (sans clé)."""
import csv
import io

from ..cache import SourceError
from .http import get

URL = "https://sdmx.oecd.org/public/rest/data/OECD.ECO.MAD,DSD_EO@DF_EO,/{areas}.{measures}.A"
MEASURES = {"GDPV_ANNPCT": ("Croissance du PIB réel", "%"), "CPI_YTYPCT": ("Inflation (IPC)", "%"), "CPIH_YTYPCT": ("Inflation (IPCH)", "%"),
            "UNR": ("Taux de chômage", "%"), "IRS": ("Taux court (3 mois)", "%"), "IRL": ("Taux long (10 ans)", "%"),
            "NLGQ": ("Solde public", "% du PIB"), "GGFLMQ": ("Dette publique (Maastricht)", "% du PIB"), "CBGDPR": ("Solde courant", "% du PIB")}


class OECD:
    name = "OCDE Economic Outlook"

    def outlook(self, start: int = 2015) -> dict:
        """{pays ISO3: {mesure: [[année, valeur], ...]}} pour toutes les zones disponibles."""
        r = get(URL.format(areas="", measures="+".join(MEASURES)), params={"startPeriod": start},
                headers={"Accept": "application/vnd.sdmx.data+csv; charset=utf-8"}, timeout=90)
        out: dict = {}
        for row in csv.DictReader(io.StringIO(r.text)):
            if row.get("OBS_VALUE"):
                out.setdefault(row["REF_AREA"], {}).setdefault(row["MEASURE"], []).append([int(row["TIME_PERIOD"]), float(row["OBS_VALUE"])])
        if not out:
            raise SourceError("OCDE : aucune observation reçue")
        for a in out.values():
            for obs in a.values():
                obs.sort()
        return out
