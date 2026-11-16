"""Composition des indices : Wikipedia (membres, secteurs, pays) et SPDR (poids du S&P 500)."""
import io

import openpyxl
import pandas as pd

from ..cache import SourceError
from .http import get

WIKI = "https://en.wikipedia.org/w/api.php"
SPY = "https://www.ssga.com/us/en/intermediary/library-content/products/fund-data/etfs/us/holdings-daily-us-en-spy.xlsx"
SUFFIX = {"London Stock Exchange": ".L", "Frankfurt Stock Exchange": ".DE", "SIX Swiss Exchange": ".SW", "Nasdaq Stockholm": ".ST",
          "Borsa Italiana": ".MI", "Bolsa de Madrid": ".MC", "Nasdaq Copenhagen": ".CO", "Warsaw Stock Exchange": ".WA",
          "Nasdaq Helsinki": ".HE", "Euronext Athens": ".AT", "Wiener Börse": ".VI"}
EURONEXT = {"France": ".PA", "Netherlands": ".AS", "Belgium": ".BR", "Portugal": ".LS", "Ireland": ".IR", "Norway": ".OL", "Italy": ".MI"}
SECTORS_FR = {"Information Technology": "Technologie", "Technology": "Technologie", "Financials": "Finance", "Banks": "Banques", "Insurance": "Assurance",
              "Financial Services": "Services financiers", "Health Care": "Santé", "Healthcare": "Santé", "Industrials": "Industrie",
              "Industrial Goods and Services": "Industrie", "Consumer Discretionary": "Conso. cyclique", "Consumer Staples": "Conso. de base",
              "Utilities": "Services publics", "Real Estate": "Immobilier", "Materials": "Matériaux", "Communication Services": "Communication",
              "Energy": "Énergie", "Construction and Materials": "Construction", "Consumer Products and Services": "Biens de conso.",
              "Food, Beverage and Tobacco": "Alimentation", "Basic Resources": "Ressources de base", "Telecommunications": "Télécoms",
              "Chemicals": "Chimie", "Personal Care, Drug and Grocery Stores": "Distribution alim.", "Travel and Leisure": "Voyages et loisirs",
              "Automobiles and Parts": "Automobile", "Retail": "Distribution", "Media": "Médias"}
OVERRIDES = {"MT.PA": "MT.AS"}  # cotation principale différente du pays du siège
COUNTRIES_FR = {"United Kingdom": "Royaume-Uni", "France": "France", "Germany": "Allemagne", "Switzerland": "Suisse", "Sweden": "Suède", "Italy": "Italie",
                "Netherlands": "Pays-Bas", "Spain": "Espagne", "Denmark": "Danemark", "Norway": "Norvège", "Poland": "Pologne", "Finland": "Finlande",
                "Belgium": "Belgique", "Greece": "Grèce", "Austria": "Autriche", "Ireland": "Irlande", "Portugal": "Portugal"}


def _table(page: str, section: int) -> pd.DataFrame:
    j = get(WIKI, params={"action": "parse", "page": page, "prop": "text", "section": section, "format": "json"}).json()
    tables = pd.read_html(io.StringIO(j["parse"]["text"]["*"]))
    return max(tables, key=len)


def sp500() -> list[dict]:
    df = _table("List_of_S&P_500_companies", 1)
    if not {"Symbol", "Security", "GICS Sector"} <= set(df.columns) or len(df) < 400:
        raise SourceError("Wikipedia : table du S&P 500 inattendue")
    weights = {}
    ws = openpyxl.load_workbook(io.BytesIO(get(SPY).content), read_only=True).active
    for r in ws.iter_rows(values_only=True):
        if r and isinstance(r[1], str) and isinstance(r[4], (int, float)):
            weights[r[1].replace(".", "-")] = float(r[4])
    out = []
    for r in df.itertuples():
        s = str(r.Symbol).replace(".", "-")
        out.append({"symbol": s, "name": r.Security, "sector": SECTORS_FR.get(r[3], r[3]), "industry": r[4], "country": "États-Unis", "weight": weights.get(s)})
    return out


def stoxx600() -> list[dict]:
    df = _table("STOXX_Europe_600", 4)
    if not {"Company", "Ticker", "Main listing", "Country", "Supersector"} <= set(df.columns) or len(df) < 400:
        raise SourceError("Wikipedia : table du STOXX Europe 600 inattendue")
    out = []
    for r in df.to_dict("records"):
        suffix = SUFFIX.get(r["Main listing"]) or EURONEXT.get(r["Country"])
        if not suffix or not isinstance(r["Ticker"], str):
            continue
        t = r["Ticker"].strip().rstrip(".").replace(" ", "-").replace(".", "-")
        out.append({"symbol": OVERRIDES.get(t + suffix, t + suffix), "name": r["Company"], "sector": SECTORS_FR.get(r["Supersector"], r["Supersector"]), "industry": r["Supersector"],
                    "country": COUNTRIES_FR.get(r["Country"], r["Country"]), "weight": None})
    return out


UNIVERSES = {"sp500": ("S&P 500", sp500, "Wikipedia + SPDR (poids)"), "stoxx600": ("STOXX Europe 600", stoxx600, "Wikipedia")}
