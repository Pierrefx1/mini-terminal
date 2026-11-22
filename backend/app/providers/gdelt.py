"""GDELT 2.0 : événements mondiaux géolocalisés, extraits des médias du monde entier, publiés toutes les 15 minutes.

Chaque fichier `AAAAMMJJHHMMSS.export.CSV.zip` (~45 Ko) liste les événements repérés dans les articles parus
pendant le quart d'heure : acteurs, type d'action (code CAMEO), classe (coopération / conflit, verbal / matériel),
échelle de Goldstein (-10 à +10), nombre d'articles, tonalité moyenne, lieu de l'action (pays FIPS, lat, lon) et URL source.

Fonctions pures (`parse`, `notable_key`) testées dans tests/test_gdelt.py ; le réseau se limite à `fetch`.
Limites : extraction automatique (doublons, erreurs de géolocalisation possibles) ; les fichiers les plus récents
paraissent avec 15 à 45 minutes de retard.
"""
from __future__ import annotations

import csv
import io
import zipfile

import httpx

from .http import get

BASE = "https://data.gdeltproject.org/gdeltv2/{slot}.export.CSV.zip"
NAME = "GDELT 2.0 (événements)"

# Colonnes du fichier export (GDELT 2.0, 61 colonnes)
C_A1CC, C_A1TYPE, C_A2CC, C_A2TYPE = 7, 12, 17, 22
C_ID, C_A1NAME, C_A2NAME, C_ROOT, C_QUAD, C_GOLD, C_ARTICLES, C_TONE = 0, 6, 16, 28, 29, 30, 33, 34
C_GEO_TYPE, C_GEO_NAME, C_GEO_FIPS, C_LAT, C_LON, C_URL = 51, 52, 53, 56, 57, 60

# Codes pays FIPS 10-4 (GDELT) -> ADM0_A3 Natural Earth (contours du globe)
FIPS = {
    "AF": "AFG", "AL": "ALB", "AG": "DZA", "AO": "AGO", "AR": "ARG", "AM": "ARM", "AS": "AUS", "AU": "AUT", "AJ": "AZE", "BF": "BHS",
    "BA": "BHR", "BG": "BGD", "BO": "BLR", "BE": "BEL", "BH": "BLZ", "BN": "BEN", "BT": "BTN", "BL": "BOL", "BK": "BIH", "BC": "BWA",
    "BR": "BRA", "BX": "BRN", "BU": "BGR", "UV": "BFA", "BM": "MMR", "BY": "BDI", "CB": "KHM", "CM": "CMR", "CA": "CAN", "CT": "CAF",
    "CD": "TCD", "CI": "CHL", "CH": "CHN", "CO": "COL", "CG": "COD", "CF": "COG", "CS": "CRI", "IV": "CIV", "HR": "HRV", "CU": "CUB",
    "CY": "CYP", "EZ": "CZE", "DA": "DNK", "DJ": "DJI", "DR": "DOM", "EC": "ECU", "EG": "EGY", "ES": "SLV", "EK": "GNQ", "ER": "ERI",
    "EN": "EST", "WZ": "SWZ", "ET": "ETH", "FJ": "FJI", "FI": "FIN", "FR": "FRA", "GB": "GAB", "GA": "GMB", "GG": "GEO", "GM": "DEU",
    "GH": "GHA", "GR": "GRC", "GL": "GRL", "GT": "GTM", "GV": "GIN", "PU": "GNB", "GY": "GUY", "HA": "HTI", "HO": "HND", "HU": "HUN",
    "IC": "ISL", "IN": "IND", "ID": "IDN", "IR": "IRN", "IZ": "IRQ", "EI": "IRL", "IS": "ISR", "IT": "ITA", "JM": "JAM", "JA": "JPN",
    "JO": "JOR", "KZ": "KAZ", "KE": "KEN", "KN": "PRK", "KS": "KOR", "KV": "KOS", "KU": "KWT", "KG": "KGZ", "LA": "LAO", "LG": "LVA",
    "LE": "LBN", "LT": "LSO", "LI": "LBR", "LY": "LBY", "LH": "LTU", "LU": "LUX", "MA": "MDG", "MI": "MWI", "MY": "MYS", "ML": "MLI",
    "MR": "MRT", "MX": "MEX", "MD": "MDA", "MG": "MNG", "MJ": "MNE", "MO": "MAR", "MZ": "MOZ", "WA": "NAM", "NP": "NPL", "NL": "NLD",
    "NC": "NCL", "NZ": "NZL", "NU": "NIC", "NG": "NER", "NI": "NGA", "MK": "MKD", "NO": "NOR", "MU": "OMN", "PK": "PAK", "PM": "PAN",
    "PP": "PNG", "PA": "PRY", "PE": "PER", "RP": "PHL", "PL": "POL", "PO": "PRT", "RQ": "PRI", "QA": "QAT", "RO": "ROU", "RS": "RUS",
    "RW": "RWA", "SA": "SAU", "SG": "SEN", "RI": "SRB", "SL": "SLE", "LO": "SVK", "SI": "SVN", "BP": "SLB", "SO": "SOM", "SF": "ZAF",
    "OD": "SDS", "SP": "ESP", "CE": "LKA", "SU": "SDN", "NS": "SUR", "SW": "SWE", "SZ": "CHE", "SY": "SYR", "TW": "TWN", "TI": "TJK",
    "TZ": "TZA", "TH": "THA", "TT": "TLS", "TO": "TGO", "TD": "TTO", "TS": "TUN", "TU": "TUR", "TX": "TKM", "UG": "UGA", "UP": "UKR",
    "AE": "ARE", "UK": "GBR", "US": "USA", "UY": "URY", "UZ": "UZB", "NH": "VUT", "VE": "VEN", "VM": "VNM", "YM": "YEM", "ZA": "ZMB",
    "ZI": "ZWE", "GZ": "PSX", "WE": "PSX", "WI": "SAH", "FK": "FLK",
    # hors contours du globe (micro-États, territoires) : comptés, sans aplat de couleur
    "SN": "SGP", "HK": "HKG", "MC": "MAC", "MT": "MLT", "MV": "MDV", "MP": "MUS", "BB": "BRB", "SE": "SYC", "CV": "CPV", "CN": "COM",
    "LS": "LIE", "MN": "MCO", "AN": "AND", "SM": "SMR", "VT": "VAT", "TN": "TON", "WS": "WSM", "KR": "KIR", "TV": "TUV", "NR": "NRU",
    "RM": "MHL", "FM": "FSM", "PS": "PLW", "AC": "ATG", "DO": "DMA", "GJ": "GRD", "SC": "KNA", "ST": "LCA", "VC": "VCT", "TP": "STP",
}

# Familles d'action CAMEO (code racine)
ROOT = {
    "01": "Déclaration", "02": "Appel", "03": "Intention de coopérer", "04": "Consultation", "05": "Coopération diplomatique",
    "06": "Coopération matérielle", "07": "Aide", "08": "Concession", "09": "Enquête", "10": "Exigence", "11": "Désapprobation",
    "12": "Rejet", "13": "Menace", "14": "Manifestation", "15": "Démonstration de force", "16": "Dégradation des relations",
    "17": "Coercition", "18": "Agression", "19": "Combats", "20": "Violence de masse",
}
NOTABLE_ROOTS = {"14", "15", "17", "18", "19", "20"}  # manifestations, posture militaire, coercition, violences
CRITICAL_ROOTS = {"19", "20"}
# Acteurs qui font d'un événement un fait géopolitique (et non un fait divers) : armée, gouvernement, rebelles, insurgés…
GEO_TYPES = {"MIL", "GOV", "REB", "INS", "SEP", "UAF", "SPY", "IGO", "OPP"}


def geopolitical(r: list[str]) -> bool:
    """Événement impliquant un acteur étatique ou armé, ou deux pays différents ; les manifestations sont toujours retenues."""
    if r[C_ROOT] == "14":
        return True
    if r[C_A1TYPE] in GEO_TYPES or r[C_A2TYPE] in GEO_TYPES:
        return True
    return bool(r[C_A1CC] and r[C_A2CC] and r[C_A1CC] != r[C_A2CC])


def fetch(slot: str) -> bytes | None:
    """Fichier d'un quart d'heure (None s'il n'est pas — ou pas encore — publié)."""
    try:
        return get(BASE.format(slot=slot)).content
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return None
        raise


def _f(s: str, default: float = 0.0) -> float:
    try:
        return float(s)
    except (TypeError, ValueError):
        return default


def parse(data: bytes, slot: str, notable_min_articles: int = 2, notable_max: int = 40) -> tuple[list[dict], list[dict]]:
    """Agrégats par pays et événements marquants d'un fichier export.

    Pays : events (tous), conflict (classes 3-4 : conflit verbal ou matériel), material (classe 4), articles et
    somme des tonalités des événements de conflit. Marquants : familles NOTABLE_ROOTS, géolocalisés, ≥ notable_min_articles
    articles, dédoublonnés par (pays, famille, lieu arrondi), les plus repris en premier.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        text = z.read(z.namelist()[0]).decode("utf-8", errors="replace")
    agg: dict[str, dict] = {}
    best: dict[tuple, dict] = {}
    for r in csv.reader(io.StringIO(text), delimiter="\t"):
        if len(r) < 61:
            continue
        iso = FIPS.get(r[C_GEO_FIPS])
        if not iso:
            continue
        quad, root, arts = r[C_QUAD], r[C_ROOT], int(_f(r[C_ARTICLES], 1))
        a = agg.setdefault(iso, {"slot": slot, "iso": iso, "events": 0, "conflict": 0, "material": 0, "articles": 0, "tone_sum": 0.0})
        a["events"] += 1
        if quad in ("3", "4"):
            a["conflict"] += 1
            a["articles"] += arts
            a["tone_sum"] += _f(r[C_TONE])
            if quad == "4":
                a["material"] += 1
        lat, lon = _f(r[C_LAT], None), _f(r[C_LON], None)
        if root in NOTABLE_ROOTS and quad in ("3", "4") and arts >= notable_min_articles and lat is not None and lon is not None and geopolitical(r):
            k = notable_key(iso, root, lat, lon)
            prev = best.get(k)
            if prev is None or arts > prev["articles"]:
                best[k] = {"id": r[C_ID], "slot": slot, "iso": iso, "root": root, "quad": int(quad), "goldstein": _f(r[C_GOLD]),
                           "articles": arts + (prev["articles"] if prev else 0), "tone": round(_f(r[C_TONE]), 2),
                           "place": r[C_GEO_NAME], "precise": r[C_GEO_TYPE] not in ("1", ""), "lat": lat, "lon": lon,
                           "actor1": r[C_A1NAME], "actor2": r[C_A2NAME], "url": r[C_URL]}
            else:
                prev["articles"] += arts
    notable = sorted(best.values(), key=lambda e: -e["articles"])[:notable_max]
    return list(agg.values()), notable


def notable_key(iso: str, root: str, lat: float, lon: float) -> tuple:
    """Même famille d'action au même endroit (≈ 10 km) : un seul événement."""
    return iso, root, round(lat, 1), round(lon, 1)
