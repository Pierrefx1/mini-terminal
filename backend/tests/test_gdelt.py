"""GDELT : lecture des fichiers d'export, codes pays, filtrage des faits divers ; regroupement des articles par sujet."""
import io
import json
import zipfile
from pathlib import Path

from app import world as w
from app.providers import gdelt


def _row(fips="UP", root="19", quad="4", articles="5", lat="49.99", lon="36.23", a1type="MIL", a2type="", a1cc="RUS", a2cc="UKR", geo_type="4", eid="1"):
    r = [""] * 61
    r[0], r[6], r[16] = eid, "RUSSIA", "UKRAINE"
    r[gdelt.C_A1CC], r[gdelt.C_A1TYPE], r[gdelt.C_A2CC], r[gdelt.C_A2TYPE] = a1cc, a1type, a2cc, a2type
    r[gdelt.C_ROOT], r[gdelt.C_QUAD], r[gdelt.C_GOLD], r[gdelt.C_ARTICLES], r[gdelt.C_TONE] = root, quad, "-10", articles, "-6.5"
    r[gdelt.C_GEO_TYPE], r[gdelt.C_GEO_NAME], r[gdelt.C_GEO_FIPS], r[gdelt.C_LAT], r[gdelt.C_LON] = geo_type, "Kharkiv, Kharkivs'ka Oblast', Ukraine", fips, lat, lon
    r[gdelt.C_URL] = f"https://example.org/{eid}"
    return "\t".join(r)


def _zip(rows):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("x.export.CSV", "\n".join(rows))
    return b.getvalue()


def test_agregats_par_pays_et_evenements_marquants():
    rows = [_row(eid="1", articles="5"), _row(eid="2", articles="3", lat="49.98"),  # même lieu, même famille : fusionnés
            _row(eid="3", quad="1", root="04"),                                       # coopération : comptée, non conflictuelle
            _row(eid="4", fips="XX"),                                                  # pays inconnu : ignoré
            _row(eid="5", fips="IS", root="18", a1type="", a2type="", a1cc="", a2cc="")]  # agression sans acteur étatique : fait divers
    countries, notable = gdelt.parse(_zip(rows), "20261122150000")
    by = {c["iso"]: c for c in countries}
    assert set(by) == {"UKR", "ISR"}
    assert by["UKR"]["events"] == 3 and by["UKR"]["conflict"] == 2 and by["UKR"]["material"] == 2 and by["UKR"]["articles"] == 8
    assert [(e["iso"], e["articles"]) for e in notable] == [("UKR", 8)]
    assert notable[0]["url"] == "https://example.org/1" and notable[0]["precise"]


def test_manifestation_toujours_retenue_et_seuil_d_articles():
    _, notable = gdelt.parse(_zip([_row(root="14", quad="3", a1type="", a2type="", a1cc="", a2cc=""), _row(eid="2", articles="1", lat="10", lon="10")]), "s")
    assert [e["root"] for e in notable] == ["14"]


def test_codes_pays_compatibles_avec_le_globe():
    geo = Path(__file__).resolve().parents[2] / "frontend/public/world/countries.geojson"
    codes = {f["properties"]["ADM0_A3"] for f in json.loads(geo.read_text())["features"]}
    hors_globe = {"SGP", "HKG", "MAC", "MLT", "MDV", "MUS", "BRB", "SYC", "CPV", "COM", "LIE", "MCO", "AND", "SMR", "VAT", "TON", "WSM",
                  "KIR", "TUV", "NRU", "MHL", "FSM", "PLW", "ATG", "DMA", "GRD", "KNA", "LCA", "VCT", "STP", "BHR"}
    assert {v for v in gdelt.FIPS.values()} - codes <= hors_globe
    assert gdelt.FIPS["UP"] == "UKR" and gdelt.FIPS["RS"] == "RUS" and gdelt.FIPS["IS"] == "ISR" and gdelt.FIPS["GZ"] == "PSX"


def test_zones_sur_des_pays_connus():
    for z in w.ZONES:
        assert z.assets and all(i in gdelt.FIPS.values() for i in z.isos), z.key


def test_regroupement_des_articles_sur_un_meme_sujet():
    items = [
        {"id": "1", "title": "Russia-bound ship still on fire after attack in Gulf of Finland", "source": "BBC", "link": "a", "published": "2026-11-22T10:00:00+00:00"},
        {"id": "2", "title": "Ship bound for Russia on fire after attack in the Gulf of Finland", "source": "France 24", "link": "b", "published": "2026-11-22T09:00:00+00:00"},
        {"id": "3", "title": "Ship on fire in Gulf of Finland after attack, says coastguard", "source": "BBC", "link": "c", "published": "2026-11-22T08:00:00+00:00"},
        {"id": "4", "title": "Indonesian factory fire kills three", "source": "DW", "link": "d", "published": "2026-11-22T09:30:00+00:00"},
        {"id": "5", "title": "Russia-bound ship on fire after attack in Gulf of Finland", "source": "Guardian", "link": "e", "published": "2026-11-19T09:00:00+00:00"},  # trop ancien
    ]
    out = w.cluster(items)
    assert [(g["id"], g["sources"]) for g in out] == [("1", 2), ("4", 1), ("5", 1)]
    assert [o["source"] for o in out[0]["others"]] == ["France 24"]
