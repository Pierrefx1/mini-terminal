"""Banque mondiale : indicateurs annuels pour tous les pays (sans clé)."""
from ..cache import SourceError
from .http import get


class WorldBank:
    name = "Banque mondiale"

    def fetch(self, countries: list[str], indicators: list[str], start: int = 1990) -> dict:
        """{indicateur: {pays ISO2: [[année, valeur], ...]}}"""
        url = f"https://api.worldbank.org/v2/country/{';'.join(countries)}/indicator/{';'.join(indicators)}"
        params = {"format": "json", "per_page": 20000, "date": f"{start}:2100"}
        if len(indicators) > 1:
            params["source"] = 2
        j = get(url, params=params, timeout=60).json()
        if not isinstance(j, list) or len(j) < 2 or j[1] is None:
            raise SourceError(f"Banque mondiale : réponse inattendue ({str(j)[:120]})")
        out: dict = {}
        for x in j[1]:
            if x["value"] is not None:
                out.setdefault(x["indicator"]["id"], {}).setdefault(x["country"]["id"], []).append([x["date"], x["value"]])
        for ind in out.values():
            for obs in ind.values():
                obs.sort()
        return out
