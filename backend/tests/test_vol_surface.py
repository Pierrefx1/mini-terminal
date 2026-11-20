"""Moteur VOL : chaîne synthétique prix Black-76 à vol connue -> l'IV recalculée doit être exacte (aucun appel réseau)."""
import json
import math

import numpy as np
import pandas as pd
import pytest

from app import vol_surface as vs

F_TRUE, RATE = 500.0, 0.04
EXPIRIES = {"2027-01-15": 30, "2027-03-19": 90, "2027-06-18": 180, "2027-12-17": 365}


def smile(k: float, T: float) -> float:
    """Vol connue : niveau qui monte avec T, skew négatif, convexité."""
    return 0.18 + 0.02 * math.sqrt(T) - 0.10 * k + 0.30 * k * k


def synthetic_chain(vol=smile, F=F_TRUE, rate=RATE, half_spread=1e-9, oi=500) -> pd.DataFrame:
    """Calls et puts sur chaque strike, bid/ask centrés exactement sur le prix Black-76 (mid = prix théorique)."""
    rows = []
    for exp, days in EXPIRIES.items():
        T = days / 365.0
        df = math.exp(-rate * T)
        for K in np.arange(350.0, 655.0, 5.0):
            v = vol(math.log(K / F), T)
            for is_call in (True, False):
                p = vs.black76_price(F, K, T, df, v, is_call)
                rows.append({"strike": K, "bid": p - half_spread, "ask": p + half_spread, "openInterest": oi,
                             "volume": 100, "is_call": is_call, "expiry": exp, "T": T})
    return pd.DataFrame(rows)


def test_implied_vol_inverse_black76():
    for is_call in (True, False):
        for K, T, v in ((450, 0.1, 0.12), (500, 0.5, 0.25), (560, 2.0, 0.6)):
            df = math.exp(-RATE * T)
            p = vs.black76_price(F_TRUE, K, T, df, v, is_call)
            assert vs.implied_vol(p, F_TRUE, K, T, df, is_call) == pytest.approx(v, abs=1e-6)


def test_implied_vol_hors_bornes_arbitrage():
    df = math.exp(-RATE * 0.5)
    assert np.isnan(vs.implied_vol(0.0, F_TRUE, 450, 0.5, df, False))                 # prix nul
    assert np.isnan(vs.implied_vol(df * 60, F_TRUE, 440, 0.5, df, True))              # sous l'intrinsèque (60)
    assert np.isnan(vs.implied_vol(df * F_TRUE + 1, F_TRUE, 500, 0.5, df, True))      # au-dessus de df·F


def test_surface_points_iv_exacte_et_forward_implicite():
    pts = vs.build_surface_points(synthetic_chain(), spot=497.0, cfg=vs.Config(rate=RATE))
    assert len(pts) > 100 and pts["expiry"].nunique() == len(EXPIRIES)
    # Forward implicite par parité call-put : exact
    assert np.allclose(pts["F"], F_TRUE, atol=1e-6)
    # IV recalculée = vol connue à 1e-6 près, sur chaque point
    expected = [smile(k, T) for k, T in zip(pts["k"], pts["T"])]
    np.testing.assert_allclose(pts["iv"], expected, rtol=0, atol=1e-6)
    # Seulement des options OTM, dans la plage de moneyness
    assert (pts["k"].abs() <= vs.Config().k_range).all()


def test_metriques_vol_plate():
    flat = lambda k, T: 0.25
    pts = vs.build_surface_points(synthetic_chain(vol=flat), spot=F_TRUE, cfg=vs.Config(rate=RATE))
    m = vs.desk_metrics(pts)
    assert list(m["days"]) == sorted(EXPIRIES.values())
    np.testing.assert_allclose(m["atm_vol"], 0.25, atol=1e-6)
    np.testing.assert_allclose(m["skew_90_110"], 0.0, atol=1e-6)
    np.testing.assert_allclose(m["fly_90_110"], 0.0, atol=1e-6)


def test_metriques_skew_et_fly_du_smile_connu():
    m = vs.desk_metrics(vs.build_surface_points(synthetic_chain(), spot=F_TRUE, cfg=vs.Config(rate=RATE)))
    k90, k110 = math.log(0.9), math.log(1.1)
    # Interpolation linéaire entre strikes de 5 : écart au smile exact borné, signe du skew conservé
    for _, r in m.iterrows():
        T = r["days"] / 365
        assert r["skew_90_110"] == pytest.approx(smile(k90, T) - smile(k110, T), abs=2e-4)
        assert r["skew_90_110"] > 0 and r["fly_90_110"] > 0


def test_surface_complete_et_serialisable():
    fig, metrics, pts = vs.surface_from_chain(synthetic_chain(), 500.0, "TEST", vs.Config(rate=RATE))
    surf = fig.data[0]
    assert np.isfinite(np.asarray(surf.z, dtype=float)).all()
    assert len(metrics) == len(EXPIRIES)


def test_filtres_et_erreurs_explicites():
    # Spread trop large -> aucun point
    wide = synthetic_chain(half_spread=50.0)
    with pytest.raises(vs.VolSurfaceError, match="Aucun point"):
        vs.build_surface_points(wide, 500.0, vs.Config(rate=RATE))
    # Intérêt ouvert insuffisant -> aucun point
    with pytest.raises(vs.VolSurfaceError, match="Aucun point"):
        vs.build_surface_points(synthetic_chain(oi=1), 500.0, vs.Config(rate=RATE))
    # Une seule échéance -> pas de surface, message clair au lieu d'une erreur Qhull
    one = synthetic_chain()
    one = one[one["expiry"] == "2027-03-19"]
    with pytest.raises(vs.VolSurfaceError, match="Trop peu de points"):
        vs.surface_from_chain(one, 500.0, "TEST", vs.Config(rate=RATE))


def test_marche_ferme_bid_ask_nuls():
    closed = synthetic_chain()
    closed[["bid", "ask"]] = 0.0
    with pytest.raises(vs.VolSurfaceError, match="hors séance"):
        vs.surface_from_chain(closed, 500.0, "TEST", vs.Config(rate=RATE))


def test_delai_reseau_depasse(monkeypatch):
    import time

    monkeypatch.setattr(vs, "fetch_chain_yf", lambda t, cfg: time.sleep(2))
    with pytest.raises(vs.VolSurfaceError, match="n'a pas répondu"):
        vs.fetch_chain("SPY", vs.Config(timeout=0.2))


def test_erreur_source_traduite(monkeypatch):
    def boom(t, cfg):
        raise ConnectionError("réseau coupé")
    monkeypatch.setattr(vs, "fetch_chain_yf", boom)
    with pytest.raises(vs.VolSurfaceError, match="ConnectionError"):
        vs.fetch_chain("SPY", vs.Config())


# ───────────────────────── maturité constante, vol réalisée, historique ─────────────────────────

def test_maturite_constante_interpolation_variance_totale():
    m = pd.DataFrame({"expiry": ["a", "b"], "days": [20, 40], "fwd": [1, 1], "atm_vol": [0.20, 0.30],
                      "skew_90_110": [0.10, 0.06], "fly_90_110": [0.02, 0.01]})
    cm = vs.constant_maturity(m, 30)
    # σ²·30 = moyenne de 0,04·20 et 0,09·40 -> σ = √(2,2/30)
    assert cm["atm_vol"] == pytest.approx(math.sqrt(2.2 / 30), abs=1e-12)
    assert cm["skew_90_110"] == pytest.approx(0.08) and cm["fly_90_110"] == pytest.approx(0.015)
    assert cm["extrapolated"] is False
    # hors plage : échéance la plus proche, signalée
    far = vs.constant_maturity(m, 90)
    assert far["atm_vol"] == pytest.approx(0.30) and far["extrapolated"] is True
    # échéance exacte : pas d'extrapolation
    assert vs.constant_maturity(m, 40)["extrapolated"] is False


def test_maturite_constante_sur_surface_plate():
    pts = vs.build_surface_points(synthetic_chain(vol=lambda k, T: 0.25), F_TRUE, vs.Config(rate=RATE))
    cm = vs.constant_maturity(vs.desk_metrics(pts), 60)
    assert cm["atm_vol"] == pytest.approx(0.25, abs=1e-6) and cm["skew_90_110"] == pytest.approx(0, abs=1e-6)


def test_vol_realisee():
    rng = np.random.default_rng(0)
    r = rng.normal(0, 0.01, 300)
    closes = 100 * np.exp(np.concatenate([[0], np.cumsum(r)]))
    rv = vs.realized_vol(closes, 20)
    assert np.isnan(rv[:20]).all() and np.isfinite(rv[20:]).all()
    assert rv[-1] == pytest.approx(np.std(r[-20:], ddof=1) * math.sqrt(252), rel=1e-12)
    assert vs.realized_vol(np.full(50, 100.0), 20)[-1] == pytest.approx(0)
    assert np.isnan(vs.realized_vol(closes[:10], 20)).all()


def test_rang_percentile():
    assert vs.percentile_rank(np.array([1, 2, 3, 4, np.nan]), 3) == pytest.approx(75)
    assert vs.percentile_rank(np.array([]), 3) is None
    assert vs.percentile_rank(np.array([1.0]), float("nan")) is None


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    from app import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init()
    return db


def test_etat_des_sources(tmp_db):
    from app import cache
    cache.cached("k1", 60, "Source A", lambda: {"x": 1})
    with pytest.raises(Exception):
        cache.cached("k2", 60, "Source A", lambda: 1 / 0)
    cache.cached("k3", 60, "Source A", lambda: {"x": 2})
    with pytest.raises(Exception):  # réponse explicite de la source : compte comme un succès
        cache.cached("k4", 60, "Source A", lambda: (_ for _ in ()).throw(cache.SourceError("pas d'options")))
    with tmp_db.conn() as c:
        h = dict(c.execute("SELECT * FROM source_health WHERE source='Source A'").fetchone())
    assert h["ok_count"] == 3 and h["err_count"] == 1
    assert "ZeroDivisionError" in h["last_error"] and h["last_ok"]


def test_historique_vol_et_comparaison_realisee(tmp_db, monkeypatch):
    from app.routers import vol
    rng = np.random.default_rng(1)
    closes = 100 * np.exp(np.cumsum(rng.normal(0, 0.01, 300)))
    candles = [{"time": 1_700_000_000 + i * 86400, "close": float(c)} for i, c in enumerate(closes)]
    monkeypatch.setattr(vol.prices, "history", lambda s, i, r: {"candles": candles})
    pts = vs.build_surface_points(synthetic_chain(), F_TRUE, vs.Config(rate=RATE))
    m = vs.desk_metrics(pts)
    snap = {"ticker": "TEST", "spot": F_TRUE, "n_points": len(pts), "cm30": vs.constant_maturity(m, 30), "cm90": vs.constant_maturity(m, 90)}
    vol.record_snapshot(snap)
    vol.record_snapshot(snap)  # même séance : une seule ligne
    d = vol.history("TEST")["data"]
    assert len(d["iv"]) == 1 and d["stats"]["n_days"] == 1
    s = d["stats"]
    assert s["iv30"] == pytest.approx(snap["cm30"]["atm_vol"])
    assert s["rv20"] == pytest.approx(np.std(np.diff(np.log(closes))[-20:], ddof=1) * math.sqrt(252), abs=1e-6)  # série arrondie à 1e-6
    assert s["spread_20"] == pytest.approx(s["iv30"] - s["rv20"])
    assert 0 <= s["iv30_pct_vs_rv20"] <= 100
    assert s["iv30_pct_own"] is None  # moins de 20 séances enregistrées


def _records(spot=497.0):
    pts = vs.build_surface_points(synthetic_chain(), spot=spot, cfg=vs.Config(rate=RATE))
    return json.loads(pts[["expiry", "T", "K", "F", "k", "iv"]].to_json(orient="records"))


def test_lookup_sur_une_echeance_cotee_retrouve_le_smile():
    T = 90 / 365
    out = vs.lookup(_records(), 497.0, [450.0, 500.0, 560.0], T)
    for K, iv in zip(out["strikes"], out["iv"]):
        assert iv == pytest.approx(smile(math.log(K / F_TRUE), T), abs=3e-4)
    assert out["forward"] == pytest.approx(F_TRUE, rel=1e-9)
    assert out["carry"] == pytest.approx(math.log(F_TRUE / 497.0) / T, rel=1e-9)
    assert not out["extrapolated"]


def test_lookup_entre_echeances_interpole_la_variance_totale():
    T0, T1, T = 90 / 365, 180 / 365, 120 / 365
    K = 500.0
    k = math.log(K / F_TRUE)
    w0, w1 = smile(k, T0) ** 2 * T0, smile(k, T1) ** 2 * T1
    expected = math.sqrt((w0 + (w1 - w0) * (T - T0) / (T1 - T0)) / T)
    out = vs.lookup(_records(), 497.0, [K], T)
    assert out["iv"][0] == pytest.approx(expected, abs=3e-4)
    assert out["expiries_used"] == [pytest.approx(T0), pytest.approx(T1)]


def test_lookup_extrapolation_plate_et_erreurs():
    out = vs.lookup(_records(), 497.0, [500.0], 3.0)
    assert out["extrapolated"] and out["iv"][0] == pytest.approx(smile(math.log(500 / F_TRUE), 1.0), abs=3e-4)
    with pytest.raises(ValueError):
        vs.lookup(_records(), 497.0, [-1.0], 0.5)
    with pytest.raises(vs.VolSurfaceError):
        vs.lookup([], 497.0, [500.0], 0.5)
