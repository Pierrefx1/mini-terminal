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

    def countries(self) -> list[dict]:
        """Pays (hors agrégats régionaux) : code ISO2 et ISO3, nom anglais, région, niveau de revenu."""
        j = get("https://api.worldbank.org/v2/country", params={"format": "json", "per_page": 400}, timeout=60).json()
        if not isinstance(j, list) or len(j) < 2 or not j[1]:
            raise SourceError("Banque mondiale : liste des pays indisponible")
        return [{"code": x["iso2Code"], "iso3": x["id"], "name": x["name"], "region": x["region"]["value"], "income": x["incomeLevel"]["value"]}
                for x in j[1] if x["region"]["id"] != "NA" and len(x["iso2Code"]) == 2]

    def latest(self, indicator: str) -> dict:
        """Dernière valeur disponible de chaque pays : {ISO2: [année, valeur]}."""
        j = get(f"https://api.worldbank.org/v2/country/all/indicator/{indicator}",
                params={"format": "json", "per_page": 400, "mrnev": 1}, timeout=60).json()
        if not isinstance(j, list) or len(j) < 2 or j[1] is None:
            raise SourceError(f"Banque mondiale : réponse inattendue ({str(j)[:120]})")
        return {x["country"]["id"]: [x["date"], x["value"]] for x in j[1] if x["value"] is not None}
