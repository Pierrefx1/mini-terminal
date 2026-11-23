"""Secteur et pays d'une valeur : profil Yahoo prioritaire (cotation étrangère comprise), repli sur l'univers du screener."""
import sys
import types

import pytest

from app.providers.yahoo_profile import YahooProfile
from app.routers import screener


def fake_yfinance(monkeypatch, infos: dict[str, dict]):
    mod = types.SimpleNamespace(Ticker=lambda s: types.SimpleNamespace(info=infos.get(s, {})))
    monkeypatch.setitem(sys.modules, "yfinance", mod)


def test_profil_traduit_secteur_et_pays(monkeypatch):
    fake_yfinance(monkeypatch, {
        "ASML": {"sector": "Technology", "industry": "Semiconductor Equipment & Materials", "country": "Netherlands"},
        "LVMUY": {"sector": "Consumer Cyclical", "industry": "Luxury Goods", "country": "France"},
        "AAPL": {"sector": "Technology", "country": "United States"},
    })
    p = YahooProfile()
    assert p.profile("ASML")["sector"] == "Technologie" and p.profile("ASML")["country"] == "Pays-Bas"
    assert p.profile("LVMUY") == {"sector": "Conso. cyclique", "country": "France", "industry": "Luxury Goods"}
    assert p.profile("AAPL")["country"] == "États-Unis"


def test_profil_vide_sans_erreur(monkeypatch):
    fake_yfinance(monkeypatch, {})
    assert YahooProfile().profile("XXX") == {"sector": None, "country": None, "industry": None}


@pytest.fixture
def no_cache(monkeypatch):
    """`cached` appelle directement la source (sans base de données)."""
    monkeypatch.setattr(screener, "cached", lambda key, ttl, source, fetch, **kw: {"data": fetch()})
    monkeypatch.setattr(screener, "lookup", lambda s: {"sector": "Biens de conso.", "country": "France"} if s == "MC.PA" else None)


def test_action_classee_par_le_profil_meme_si_dans_un_univers(monkeypatch, no_cache):
    monkeypatch.setattr(screener.profiles, "profile", lambda s: {"sector": "Conso. cyclique", "country": "France", "industry": None})
    assert screener.classify("MC.PA", "EQUITY")["sector"] == "Conso. cyclique"


def test_repli_sur_l_univers_si_le_profil_echoue(monkeypatch, no_cache):
    def boom(s):
        raise RuntimeError("Yahoo injoignable")
    monkeypatch.setattr(screener.profiles, "profile", boom)
    assert screener.classify("MC.PA", "EQUITY") == {"sector": "Biens de conso.", "country": "France"}
    assert screener.classify("ASML", "EQUITY") is None  # le portefeuille se rabat alors sur le suffixe


def test_pas_de_profil_pour_un_etf(monkeypatch, no_cache):
    def never(s):
        raise AssertionError("profil demandé pour un ETF")
    monkeypatch.setattr(screener.profiles, "profile", never)
    assert screener.classify("SPY", "ETF") is None
