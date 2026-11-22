"""Tradier : conversion des réponses (objet seul ou liste), choix des échéances, volatilité à 30 jours, erreurs de clé."""
from datetime import date

import pytest

from app.cache import SourceError
from app.providers import tradier as t


def opt(typ="call", strike=100.0, exp="2026-12-18", iv=0.25, oi=10, greeks=True):
    o = {"symbol": "SPY261218C00100000", "option_type": typ, "strike": strike, "expiration_date": exp, "bid": 1.0, "ask": 1.2,
         "last": 1.1, "volume": 5, "open_interest": oi, "change": 0.1}
    if greeks:
        o["greeks"] = {"delta": 0.5, "gamma": 0.02, "theta": -0.03, "vega": 0.1, "rho": 0.01, "mid_iv": iv, "smv_vol": iv + 0.01, "updated_at": "2026-11-20 15:00:00"}
    return o


def test_objet_seul_liste_ou_null():
    assert t._items({"option": [1, 2]}, "option") == [1, 2]
    assert t._items({"option": {"a": 1}}, "option") == [{"a": 1}]
    assert t._items({"date": "2026-12-18"}, "date") == ["2026-12-18"]
    assert t._items(None, "option") == [] and t._items("null", "option") == []


def test_conversion_au_format_du_terminal():
    r = t.convert(opt())
    assert r["type"] == "call" and r["strike"] == 100.0 and r["expiry"] == "2026-12-18"
    assert r["iv"] == 0.25 and r["delta"] == 0.5 and r["oi"] == 10 and r["theo"] is None
    assert t.convert(opt(greeks=False))["iv"] is None  # grecques absentes : la ligne reste, sans VI
    assert t.convert({**opt(), "option_type": None}) is None


def test_choix_des_echeances():
    today = date(2026, 11, 22)
    weeklies = [date.fromordinal(today.toordinal() + d).isoformat() for d in range(1, 45, 2)]   # 22 échéances proches
    far = [f"{y}-{m:02d}-15" for y in (2027, 2028) for m in range(1, 13)]                          # 24 mensuelles lointaines
    out = t.pick_expiries(weeklies + far + ["2031-01-17"], today)
    assert len(out) == t.MAX_EXPIRIES and out == sorted(out)
    assert out[0] == weeklies[0]                       # la plus proche est toujours chargée
    assert "2031-01-17" not in out                     # au-delà de MAX_DAYS
    assert far[-1] in out or max(out) >= "2028-10-15"  # la surface couvre la fin de l'horizon
    assert t.pick_expiries(["2026-11-20"], today) == []  # échue


def test_volatilite_a_30_jours_interpolee():
    today = date(2026, 11, 22)
    rows = [t.convert(opt(exp="2026-12-12", iv=0.20, strike=100)), t.convert(opt("put", exp="2026-12-12", iv=0.22, strike=100)),
            t.convert(opt(exp="2026-12-22", iv=0.30, strike=100)), t.convert(opt(exp="2026-12-22", iv=0.50, strike=120))]
    # 20 j : ATM 21 % ; 30 j : ATM 30 % (le strike 120 est loin du cours)
    assert t.iv30(rows, 101.0, today) == pytest.approx(30.0)
    assert t.iv30(rows[:2], 101.0, today) == pytest.approx(21.0)


def test_cle_absente():
    with pytest.raises(SourceError, match="TRADIER_API_KEY"):
        t.Tradier(key="").chain("SPY")


def test_symboles_d_indices():
    assert t.tradier_symbol("^GSPC") == "SPX" and t.tradier_symbol("spy") == "SPY"
