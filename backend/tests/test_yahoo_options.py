"""Options Yahoo : grecques Black-Scholes, VI recalculée, choix des échéances, volatilité à 30 jours."""
import math
from datetime import date

import pytest

from app.providers import yahoo_options as y


def test_grecques_black_scholes_reference():
    # Hull : S=42, K=40, r=10 %, σ=20 %, T=0,5 -> call 4,76, put 0,81
    c, p = y.greeks(42, 40, 0.5, 0.2, True, r=0.10), y.greeks(42, 40, 0.5, 0.2, False, r=0.10)
    assert c["theo"] == pytest.approx(4.76, abs=0.01) and p["theo"] == pytest.approx(0.81, abs=0.01)
    assert c["delta"] - p["delta"] == pytest.approx(1.0)            # parité des deltas
    assert c["gamma"] == pytest.approx(p["gamma"]) and c["vega"] == pytest.approx(p["vega"])
    assert c["theta"] < 0 and c["rho"] > 0 > p["rho"]
    # vega pour 1 point : écart de prix quand la vol passe de 20 % à 21 %
    up = y.greeks(42, 40, 0.5, 0.21, True, r=0.10)["theo"]
    assert up - c["theo"] == pytest.approx(c["vega"], rel=0.02)
    assert y.greeks(42, 40, 0.5, 0, True)["delta"] is None          # sans vol : pas de grecques


def test_vi_recalculee_sur_le_milieu_et_repli_yahoo():
    S, K, T = 100.0, 100.0, 0.25
    price = y.greeks(S, K, T, 0.30, True)["theo"]
    r = y.row({"strike": K, "bid": price - 0.05, "ask": price + 0.05, "impliedVolatility": 0.9, "volume": 3, "openInterest": 12}, "2027-02-19", True, S, T)
    assert r["iv"] == pytest.approx(0.30, abs=0.002) and r["oi"] == 12 and r["type"] == "call"
    # bid nul : VI Yahoo en repli si plausible, sinon aucune
    assert y.row({"strike": K, "bid": 0, "ask": 0.1, "impliedVolatility": 0.45}, "2027-02-19", False, S, T)["iv"] == 0.45
    assert y.row({"strike": K, "bid": 0, "ask": 0.1, "impliedVolatility": 1e-5}, "2027-02-19", False, S, T)["iv"] is None
    assert y.row({"strike": K, "bid": float("nan"), "ask": None, "volume": float("nan")}, "2027-02-19", True, S, T)["volume"] is None


def test_forward_par_parite_call_put():
    S, T, F = 100.0, 0.5, 98.0  # dividende : forward sous S·e^{rT}
    df = math.exp(-y.RATE * T)
    def quotes(k):
        c = y.greeks(F * df, k, T, 0.25, True)["theo"]; p = y.greeks(F * df, k, T, 0.25, False)["theo"]
        return {"strike": k, "bid": c - 0.02, "ask": c + 0.02}, {"strike": k, "bid": p - 0.02, "ask": p + 0.02}
    pairs = [quotes(k) for k in (90, 95, 100, 105, 110)]
    f = y.implied_forward([c for c, _ in pairs], [p for _, p in pairs], S, T)
    assert f == pytest.approx(F, abs=0.01)
    # même vol déduite du call et du put au même strike, une fois le forward connu
    c, p = pairs[2]
    s_eq = f * df
    assert y.row(c, "x", True, s_eq, T)["iv"] == pytest.approx(y.row(p, "x", False, s_eq, T)["iv"], abs=0.002)
    assert y.implied_forward([], [], S, T) == pytest.approx(S * math.exp(y.RATE * T))


def test_choix_des_echeances():
    today = date(2026, 11, 22)
    weeklies = [date.fromordinal(today.toordinal() + d).isoformat() for d in range(1, 45, 2)]
    far = [f"{a}-{m:02d}-15" for a in (2027, 2028) for m in range(1, 13)]
    out = y.pick_expiries(weeklies + far + ["2031-01-17", "2026-11-20"], today)
    assert len(out) == y.MAX_EXPIRIES and out == sorted(out)
    assert out[0] == weeklies[0] and far[-1] in out
    assert "2031-01-17" not in out and "2026-11-20" not in out


def test_volatilite_a_30_jours_interpolee():
    today = date(2026, 11, 22)
    mk = lambda e, iv, k=100.0, typ="call": {"expiry": e, "type": typ, "strike": k, "iv": iv}
    rows = [mk("2026-12-12", 0.20), mk("2026-12-12", 0.22, typ="put"), mk("2026-12-22", 0.30), mk("2026-12-22", 0.50, 120.0)]
    assert y.iv30(rows, 101.0, today) == pytest.approx(30.0)
    assert y.iv30(rows[:2], 101.0, today) == pytest.approx(21.0)
    assert y.iv30([], 101.0, today) is None


def test_symboles_d_indices():
    assert y.yahoo_symbol("^GSPC") == "^SPX" and y.yahoo_symbol("spy") == "SPY"
    assert math.isfinite(y.RATE)
