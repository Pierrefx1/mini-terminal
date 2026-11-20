"""WORLD MONITOR : géolocalisation, classement des actualités, corrélations entre places (sans réseau)."""
import math

import numpy as np
import pytest

from app import world as w


@pytest.mark.parametrize("title,iso,label", [
    ("Ukraine says Russian drone attack hits Kharkiv", "UKR", "Kharkiv"),
    ("Israeli strikes on Gaza kill 30, health officials say", "PSX", "Gaza"),       # zone de conflit prioritaire
    ("North Korea fires ballistic missile into sea", "PRK", "Corée du Nord"),
    ("Houthis attack ship in Red Sea", "YEM", "Mer Rouge"),
    ("Le Maroc et l'Algérie : tensions diplomatiques", "MAR", "Maroc"),             # premier pays cité
    ("Fed holds rates steady as inflation cools", "USA", "États-Unis"),
    ("ECB's Lagarde warns on growth", "EUU", "BCE (Francfort)"),
    ("US tariffs hit Chinese exports", "CHN", "Chine"),                              # « US » faible : cède à un pays nommé
    ("Trump signs executive order", "USA", "États-Unis"),                            # faible, mais seul lieu
])
def test_geolocalisation(title, iso, label):
    p = w.geolocate(title)
    assert p is not None and (p.iso, p.label) == (iso, label)


def test_pas_de_faux_positifs():
    assert w.geolocate("Markets rally as investors cheer earnings") is None
    assert w.geolocate("We discuss it with us tomorrow") is None                      # « us » minuscule n'est pas les États-Unis
    assert w.geolocate("Jordan Bardella et Chad Smith") is None                       # prénoms ambigus exclus
    assert w.geolocate("Romania's election", "").iso == "ROU"
    assert w.geolocate("", "Talks resumed in Kyiv on Monday").label == "Ukraine"     # résumé utilisé à défaut du titre


@pytest.mark.parametrize("title,cat,critical", [
    ("Russian missile strike kills 12 in Odesa", "risk", True),
    ("EU agrees new sanctions package on Russia", "risk", False),
    ("Spaniards vote in snap election", "event", False),
    ("Earthquake hits southern Japan", "event", False),
    ("China's exports slow as tariffs bite", "econ", False),
    ("Guerre au Soudan : des dizaines de morts à El-Fasher", "risk", True),
    ("Royal wedding draws crowds", None, False),
])
def test_classement(title, cat, critical):
    r = w.classify(title)
    assert (r[0] if r else None) == cat
    if r:
        assert r[1] is critical


def test_tous_les_pays_ont_des_coordonnees_valides():
    for iso, (name, lat, lon, pats) in w.COUNTRIES.items():
        assert -90 <= lat <= 90 and -180 <= lon <= 180 and pats, iso
    for code, city, iso, lat, lon, *_ in w.CENTERS:
        assert -90 <= lat <= 90 and -180 <= lon <= 180


def test_correlations():
    rng = np.random.default_rng(3)
    base = rng.normal(0, 0.01, 120)
    dates = [f"2026-{1 + i // 28:02d}-{1 + i % 28:02d}" for i in range(121)]
    px = lambda r: list(zip(dates, 100 * np.exp(np.concatenate([[0], np.cumsum(r)]))))
    series = {"A": px(base), "B": px(base * 2), "C": px(-base), "D": px(rng.normal(0, 0.01, 120)), "E": px(base)[:20]}
    out = {(a, b): (r, n) for a, b, r, n in w.correlations(series, window=60)}
    assert out[("A", "B")][0] == pytest.approx(1.0) and out[("A", "B")][1] == 60
    assert out[("A", "C")][0] == pytest.approx(-1.0)
    assert abs(out[("A", "D")][0]) < 0.4
    assert not any("E" in k for k in out)            # trop peu d'observations communes
    # corrélation calculée sur les dates communes uniquement
    gap = {"A": series["A"], "F": [p for i, p in enumerate(series["A"]) if i % 2 == 0]}
    assert all(math.isfinite(r) for *_, r, _ in w.correlations(gap, window=60, min_obs=10))
