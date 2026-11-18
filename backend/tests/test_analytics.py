import math
from datetime import datetime, timezone

import pytest

from app.analytics import breadth, perf_stats

DAY = 86400


def bars(closes, start="2025-12-29", vol=1000):
    t0 = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp())
    return [{"time": t0 + i * DAY, "open": c, "high": c * 1.01, "low": c * 0.99, "close": c, "volume": vol} for i, c in enumerate(closes)]


def test_variations_en_seances():
    closes = [100 + i for i in range(30)]  # 100 .. 129
    s = perf_stats(bars(closes))
    assert s["last"] == 129
    assert s["d1"] == pytest.approx((129 / 128 - 1) * 100)
    assert s["w1"] == pytest.approx((129 / 124 - 1) * 100)   # 5 séances
    assert s["m1"] == pytest.approx((129 / 108 - 1) * 100)   # 21 séances


def test_prix_courant_remplace_la_derniere_cloture():
    # 110 est la clôture provisoire de la séance en cours : 121 la remplace, la référence reste 100
    s = perf_stats(bars([100, 110]), price=121)
    assert s["last"] == 121 and s["d1"] == pytest.approx(21)


def test_ytd_depuis_la_derniere_cloture_de_l_annee_precedente():
    # 29, 30, 31 décembre 2025 puis 1er et 2 janvier 2026
    s = perf_stats(bars([90, 95, 100, 104, 110]))
    assert s["ytd"] == pytest.approx(10)


def test_ytd_tient_compte_du_fuseau_de_la_place():
    # bougie horodatée 31/12 23:00 UTC = 1er janvier 08:00 à Tokyo (UTC+9)
    t = int(datetime(2025, 12, 31, 23, tzinfo=timezone.utc).timestamp())
    c = [{"time": t - DAY, "open": 100, "high": 100, "low": 100, "close": 100, "volume": 0},
         {"time": t, "open": 120, "high": 120, "low": 120, "close": 120, "volume": 0}]
    assert perf_stats(c, gmtoffset=9 * 3600)["ytd"] == pytest.approx(20)
    assert perf_stats(c, gmtoffset=0)["ytd"] is None  # tout en 2025 vu de Londres


def test_plus_haut_plus_bas_et_position():
    s = perf_stats(bars([100, 200, 150]))
    assert s["hi52"] == pytest.approx(202) and s["lo52"] == pytest.approx(99)
    assert s["range_pos"] == pytest.approx((150 - 99) / (202 - 99) * 100)
    assert s["from_hi52"] == pytest.approx((150 / 202 - 1) * 100)


def test_volatilite_realisee_annualisee():
    closes = [100 * (1.01 if i % 2 else 0.99) ** 0 for i in range(25)]
    assert perf_stats(bars(closes))["vol20"] == pytest.approx(0)
    # alternance +1 % / -1 % : écart-type des log-rendements x racine(252)
    closes = [100.0]
    for i in range(24):
        closes.append(closes[-1] * (1.01 if i % 2 == 0 else 0.99))
    rets = [math.log(b / a) for a, b in zip(closes[-21:-1], closes[-20:])]
    m = sum(rets) / len(rets)
    expected = math.sqrt(sum((r - m) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(252) * 100
    assert perf_stats(bars(closes))["vol20"] == pytest.approx(expected)


def test_historique_court_sans_erreur():
    s = perf_stats(bars([100]))
    assert s["d1"] is None and s["w1"] is None and s["vol20"] is None
    assert perf_stats([]) == {}


def test_volume_nul_des_indices_ignore():
    s = perf_stats(bars([100, 101], vol=0))
    assert s["volume"] is None and s["avg_volume20"] is None


def test_largeur_de_marche():
    b = breadth([1.0, 2.0, -1.0, 0.0, None])
    assert (b["up"], b["down"], b["flat"], b["total"]) == (2, 1, 1, 4)
    assert b["ad_ratio"] == 2 and b["median"] == pytest.approx(0.5)
    assert breadth([])["median"] is None
