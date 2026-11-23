"""Profil de société Yahoo Finance via yfinance : secteur et pays du siège, quelle que soit la cotation.

Sert à classer les valeurs hors des univers du screener (S&P 500, STOXX 600), en particulier les cotations
étrangères d'une société (ASML au Nasdaq : Pays-Bas ; LVMUY, ADR de LVMH : France), que le suffixe du symbole
ne permet pas de situer.
"""
from .universe import COUNTRIES_FR, SECTORS_FR

# secteurs Yahoo (classification Morningstar) absents de la table commune
YAHOO_SECTORS = {"Consumer Cyclical": "Conso. cyclique", "Consumer Defensive": "Conso. de base", "Basic Materials": "Matériaux"}
MORE_COUNTRIES = {"United States": "États-Unis", "Japan": "Japon", "China": "Chine", "Hong Kong": "Hong Kong", "Taiwan": "Taïwan",
                  "South Korea": "Corée du Sud", "Canada": "Canada", "Australia": "Australie", "India": "Inde", "Brazil": "Brésil",
                  "Israel": "Israël", "Luxembourg": "Luxembourg", "Singapore": "Singapour", "Mexico": "Mexique", "Bermuda": "Bermudes",
                  "Cayman Islands": "Îles Caïmans", "Jersey": "Jersey", "Argentina": "Argentine", "South Africa": "Afrique du Sud"}


class YahooProfile:
    name = "Yahoo Finance (profil société)"

    def profile(self, symbol: str) -> dict:
        import yfinance as yf  # import différé : module lourd, inutile tant qu'aucun profil n'est demandé
        info = yf.Ticker(symbol).info or {}
        sector, country = info.get("sector"), info.get("country")
        return {"sector": YAHOO_SECTORS.get(sector) or SECTORS_FR.get(sector, sector) if sector else None,
                "country": COUNTRIES_FR.get(country) or MORE_COUNTRIES.get(country, country) if country else None,
                "industry": info.get("industry")}
