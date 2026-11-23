"""Reprise en tâche de fond d'une source en échec : programmée à l'échec, délai croissant, retirée au succès."""
import pytest

from app import cache
from app.cache import SourceError


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    from app import db
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "t.db")
    db.init()
    monkeypatch.setattr(cache, "_retry_thread", object.__new__(type("Alive", (), {"is_alive": lambda self: True})))  # pas de vrai fil
    cache._retries.clear()
    yield db
    cache._retries.clear()


def test_echec_programme_une_reprise_puis_succes_la_retire(tmp_db):
    state = {"up": False}

    def fetch():
        if not state["up"]:
            raise ConnectionError("DNS")
        return {"v": 1}

    with pytest.raises(Exception):  # aucune valeur connue : 502
        cache.cached("k", 60, "Src", fetch)
    assert [r["key"] for r in cache.pending_retries()] == ["k"]
    first = cache._retries["k"]["due"]

    with pytest.raises(Exception):  # nouvel échec : délai doublé
        cache.cached("k", 60, "Src", fetch, force=True)
    assert cache._retries["k"]["n"] == 1 and cache._retries["k"]["due"] > first + 50

    state["up"] = True
    assert cache.cached("k", 60, "Src", fetch, force=True)["data"] == {"v": 1}
    assert cache.pending_retries() == []


def test_delai_plafonne(tmp_db):
    def fetch():
        raise ConnectionError("DNS")
    for _ in range(12):
        with pytest.raises(Exception):
            cache.cached("k", 60, "Src", fetch, force=True)
    r = cache.pending_retries()[0]
    assert r["attempts"] == 12 and r["next_in_s"] <= cache.RETRY_MAX


def test_reponse_explicite_de_la_source_pas_de_reprise(tmp_db):
    def fetch():
        raise SourceError("ticker sans options")
    with pytest.raises(Exception):
        cache.cached("k", 60, "Src", fetch)
    assert cache.pending_retries() == []
