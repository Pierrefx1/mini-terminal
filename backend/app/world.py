"""WORLD MONITOR : géolocalisation et classement des actualités, places financières, liens entre places.

Fonctions pures (aucun réseau), testées dans tests/test_world.py. Les données affichées sur le globe
proviennent toutes de sources réelles (flux RSS, calendrier ForexFactory, cours Yahoo) ; les seules données
de référence codées ici sont des coordonnées géographiques et la liste des grands corridors énergétiques
et commerciaux, présentés comme tels (aucun volume chiffré inventé).
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from dataclasses import dataclass

import numpy as np

# ───────────────────────────── Pays : code Natural Earth (ADM0_A3), nom, capitale (lat, lon), motifs ─────────────────────────────
# Motifs insensibles à la casse, français et anglais (nom, gentilé, capitale). Les noms ambigus (Georgia, Jordan, Chad,
# Guinea, Turkey en minuscule…) sont exclus ou restreints pour éviter les faux positifs.
COUNTRIES: dict[str, tuple[str, float, float, list[str]]] = {
    "USA": ("États-Unis", 38.90, -77.04, [r"united states", r"américain(e)?s?", r"états-unis", r"washington", r"white house", r"maison blanche", r"pentagon(e)?", r"american", r"\bFed\b", r"federal reserve", r"\bfomc\b", r"powell", r"wall street", r"s&p 500", r"dow jones", r"nasdaq"]),
    "CAN": ("Canada", 45.42, -75.70, [r"canada", r"canadi(a|e)n(ne)?s?", r"ottawa", r"toronto"]),
    "MEX": ("Mexique", 19.43, -99.13, [r"mexico", r"mexique", r"mexican", r"mexicain(e)?s?"]),
    "BRA": ("Brésil", -15.79, -47.88, [r"brazil(ian)?", r"brésil(ien(ne)?s?)?", r"brasilia", r"são paulo|sao paulo"]),
    "ARG": ("Argentine", -34.60, -58.38, [r"argentin(a|e|ian|ien(ne)?)s?", r"buenos aires", r"milei"]),
    "CHL": ("Chili", -33.45, -70.67, [r"chile(an)?", r"chili(en(ne)?s?)?", r"santiago"]),
    "COL": ("Colombie", 4.71, -74.07, [r"colombia(n)?", r"colombi(e|en(ne)?s?)", r"bogot(a|á)"]),
    "VEN": ("Venezuela", 10.48, -66.90, [r"venezuela(n)?", r"vénézuéli(en(ne)?s?)?", r"caracas", r"maduro"]),
    "PER": ("Pérou", -12.05, -77.04, [r"peru(vian)?", r"pérou", r"lima"]),
    "CUB": ("Cuba", 23.11, -82.37, [r"cuba(n)?", r"cubain(e)?s?", r"havana|la havane"]),
    "HTI": ("Haïti", 18.59, -72.31, [r"ha[iï]ti(an)?", r"port-au-prince"]),
    "ECU": ("Équateur", -0.18, -78.47, [r"ecuador(ian)?", r"équateur", r"quito"]),
    "BOL": ("Bolivie", -16.50, -68.15, [r"bolivia(n)?", r"bolivie", r"la paz"]),
    "GBR": ("Royaume-Uni", 51.51, -0.13, [r"united kingdom", r"royaume-uni", r"britain", r"british", r"britannique(s)?", r"london", r"londres", r"downing street", r"bank of england", r"banque d'angleterre", r"ftse", r"\bu\.k\.", r"england", r"angleterre", r"scotland", r"écosse"]),
    "IRL": ("Irlande", 53.35, -6.26, [r"ireland", r"irlande", r"irish", r"irlandais(e)?s?", r"dublin"]),
    "FRA": ("France", 48.86, 2.35, [r"france", r"french", r"français(e)?s?", r"paris", r"élysée|elysee", r"macron", r"matignon", r"cac 40", r"banque de france"]),
    "DEU": ("Allemagne", 52.52, 13.40, [r"germany", r"german", r"allemagne", r"allemand(e)?s?", r"berlin", r"frankfurt|francfort", r"bundesbank", r"\bdax\b"]),
    "ITA": ("Italie", 41.90, 12.50, [r"italy", r"italian", r"itali(e|en(ne)?s?)", r"rome", r"milan"]),
    "ESP": ("Espagne", 40.42, -3.70, [r"spain", r"spanish", r"espagne", r"espagnol(e)?s?", r"madrid"]),
    "PRT": ("Portugal", 38.72, -9.14, [r"portugal", r"portugu(ese|ais(e)?s?)", r"lisbon(ne)?"]),
    "NLD": ("Pays-Bas", 52.37, 4.90, [r"netherlands", r"pays-bas", r"dutch", r"néerlandais(e)?s?", r"amsterdam", r"the hague|la haye"]),
    "BEL": ("Belgique", 50.85, 4.35, [r"belgi(um|que)", r"belg(ian|e)s?", r"brussels|bruxelles"]),
    "CHE": ("Suisse", 46.95, 7.45, [r"switzerland", r"suisse(s)?", r"swiss", r"zurich", r"geneva|genève", r"\bbern(e)?\b", r"davos"]),
    "AUT": ("Autriche", 48.21, 16.37, [r"austria(n)?", r"autrich(e|ien(ne)?s?)", r"vienna|vienne"]),
    "POL": ("Pologne", 52.23, 21.01, [r"poland", r"polish", r"pologne", r"polonais(e)?s?", r"warsaw|varsovie"]),
    "SWE": ("Suède", 59.33, 18.07, [r"sweden", r"swedish", r"suède", r"suédois(e)?s?", r"stockholm"]),
    "NOR": ("Norvège", 59.91, 10.75, [r"norway", r"norwegian", r"norv(è|e)ge", r"norvégien(ne)?s?", r"oslo"]),
    "FIN": ("Finlande", 60.17, 24.94, [r"finland", r"finnish", r"finlande", r"finlandais(e)?s?", r"helsinki"]),
    "DNK": ("Danemark", 55.68, 12.57, [r"denmark", r"danish", r"danemark", r"danois(e)?", r"copenhagen|copenhague"]),
    "GRL": ("Groenland", 64.18, -51.72, [r"greenland", r"groenland", r"nuuk"]),
    "GRC": ("Grèce", 37.98, 23.73, [r"greece", r"greek", r"grèce", r"grec(que)?s?", r"athens|athènes"]),
    "TUR": ("Turquie", 39.93, 32.86, [r"türkiye", r"\bTurkey\b", r"turquie", r"turkish", r"turc(que)?s?", r"ankara", r"istanbul", r"erdogan|erdoğan"]),
    "HUN": ("Hongrie", 47.50, 19.04, [r"hungar(y|ian)", r"hongri(e|ois(e)?s?)", r"budapest", r"orb(a|á)n"]),
    "ROU": ("Roumanie", 44.43, 26.10, [r"romania(n)?", r"roumani(e|en(ne)?s?)", r"bucharest|bucarest"]),
    "SRB": ("Serbie", 44.79, 20.45, [r"serbia(n)?", r"serbe(s)?", r"serbie", r"belgrade"]),
    "UKR": ("Ukraine", 50.45, 30.52, [r"ukrain(e|ian|ien(ne)?s?)", r"kyiv|kiev", r"zelensky(y)?", r"kharkiv", r"odesa|odessa", r"donbas(s)?", r"zaporizhzhia"]),
    "RUS": ("Russie", 55.76, 37.62, [r"russia(n)?", r"russie", r"russe(s)?", r"moscow|moscou", r"kremlin", r"putin|poutine"]),
    "BLR": ("Biélorussie", 53.90, 27.57, [r"belarus(ian)?", r"biélorussie", r"minsk", r"lukashenko|loukachenko"]),
    "ISR": ("Israël", 31.77, 35.21, [r"israel(i)?s?", r"isra(ë|e)l(ien(ne)?s?)?", r"jerusalem|jérusalem", r"tel aviv", r"netanyahu|netanyahou", r"\bidf\b"]),
    "PSX": ("Palestine", 31.50, 34.47, [r"gaza", r"palestin(e|ian|ien(ne)?s?)", r"west bank|cisjordanie", r"hamas", r"ramallah"]),
    "LBN": ("Liban", 33.89, 35.50, [r"leban(on|ese)", r"liban(ais(e)?s?)?", r"beirut|beyrouth", r"hezbollah"]),
    "SYR": ("Syrie", 33.51, 36.29, [r"syria(n)?", r"syrie(n(ne)?s?)?", r"damascus|damas", r"aleppo|alep"]),
    "JOR": ("Jordanie", 31.95, 35.93, [r"jordanie(n(ne)?s?)?", r"jordanian", r"amman"]),
    "IRQ": ("Irak", 33.31, 44.37, [r"iraq(i)?s?", r"irak(ien(ne)?s?)?", r"baghdad|bagdad"]),
    "IRN": ("Iran", 35.69, 51.39, [r"\biran(ian)?s?\b", r"iranien(ne)?s?", r"tehran|téhéran", r"khamenei", r"hormuz|ormuz"]),
    "SAU": ("Arabie saoudite", 24.71, 46.68, [r"saudi", r"arabie saoudite", r"saoudien(ne)?s?", r"riyadh|riyad", r"aramco"]),
    "ARE": ("Émirats arabes unis", 24.45, 54.38, [r"\buae\b", r"emirati", r"émirats", r"united arab emirates", r"dubai|dubaï", r"abu dhabi|abou dhabi"]),
    "QAT": ("Qatar", 25.29, 51.53, [r"qatar(i)?", r"doha"]),
    "KWT": ("Koweït", 29.38, 47.99, [r"kuwait(i)?", r"kowe(ï|i)t"]),
    "YEM": ("Yémen", 15.37, 44.19, [r"yemen(i)?", r"yémen(ite)?s?", r"houthi(s)?", r"sanaa|sanaa", r"red sea|mer rouge"]),
    "OMN": ("Oman", 23.59, 58.41, [r"\boman(i)?\b", r"muscat|mascate"]),
    "EGY": ("Égypte", 30.04, 31.24, [r"egypt(ian)?", r"égypt(e|ien(ne)?s?)", r"cairo|le caire", r"suez"]),
    "LBY": ("Libye", 32.89, 13.19, [r"liby(a|an|e|en(ne)?s?)", r"tripoli", r"benghazi"]),
    "TUN": ("Tunisie", 36.81, 10.18, [r"tunisi(a|an|e|en(ne)?s?)", r"tunis\b"]),
    "DZA": ("Algérie", 36.75, 3.06, [r"algeria(n)?", r"algéri(e|en(ne)?s?)", r"algiers|alger\b"]),
    "MAR": ("Maroc", 34.02, -6.84, [r"morocc(o|an)", r"maroc(ain(e)?s?)?", r"rabat", r"casablanca"]),
    "SDN": ("Soudan", 15.50, 32.56, [r"\bsudan(ese)?\b", r"\bsoudan(ais(e)?s?)?\b", r"khartoum", r"darfur|darfour", r"\brsf\b"]),
    "SDS": ("Soudan du Sud", 4.85, 31.58, [r"south sudan", r"soudan du sud", r"juba"]),
    "ETH": ("Éthiopie", 9.03, 38.74, [r"ethiopia(n)?", r"éthiopi(e|en(ne)?s?)", r"addis ababa|addis-abeba", r"tigray"]),
    "SOM": ("Somalie", 2.05, 45.32, [r"somali(a|e|en(ne)?s?)?", r"mogadishu|mogadiscio", r"al-shabaab|chabab"]),
    "KEN": ("Kenya", -1.29, 36.82, [r"kenya(n)?", r"kényan(e)?s?", r"nairobi"]),
    "NGA": ("Nigeria", 9.08, 7.40, [r"nigeria(n)?", r"nigérian(e)?s?", r"abuja", r"lagos"]),
    "NER": ("Niger", 13.51, 2.11, [r"\bniger\b", r"nigérien(ne)?s?", r"niamey"]),
    "MLI": ("Mali", 12.64, -8.00, [r"\bmali(an)?\b", r"malien(ne)?s?", r"bamako"]),
    "BFA": ("Burkina Faso", 12.37, -1.52, [r"burkina", r"ouagadougou"]),
    "TCD": ("Tchad", 12.13, 15.06, [r"tchad(ien(ne)?s?)?", r"n'djamena"]),
    "SEN": ("Sénégal", 14.69, -17.45, [r"senegal(ese)?", r"sénégal(ais(e)?s?)?", r"dakar"]),
    "GHA": ("Ghana", 5.60, -0.19, [r"ghana(ian)?", r"accra"]),
    "CIV": ("Côte d'Ivoire", 5.36, -4.01, [r"ivory coast", r"côte d'ivoire", r"ivoirien(ne)?s?", r"abidjan"]),
    "COD": ("RD Congo", -4.44, 15.27, [r"\bdrc\b", r"\brdc\b", r"\bcongo(lese|lais(e)?s?)?\b", r"kinshasa", r"goma", r"\bm23\b"]),
    "RWA": ("Rwanda", -1.95, 30.06, [r"rwanda(n|ais(e)?s?)?", r"kigali"]),
    "AGO": ("Angola", -8.84, 13.23, [r"angola(n|is(e)?s?)?", r"luanda"]),
    "ZAF": ("Afrique du Sud", -25.75, 28.19, [r"south africa(n)?", r"afrique du sud", r"sud-africain(e)?s?", r"pretoria", r"johannesburg", r"cape town|le cap"]),
    "MOZ": ("Mozambique", -25.97, 32.57, [r"mozambi(que|can)", r"maputo"]),
    "MDG": ("Madagascar", -18.88, 47.51, [r"madagascar", r"malagasy|malgache(s)?", r"antananarivo"]),
    "IND": ("Inde", 28.61, 77.21, [r"\bindia(n)?s?\b", r"\binde\b", r"indien(ne)?s?", r"new delhi|delhi", r"mumbai|bombay", r"\bmodi\b"]),
    "PAK": ("Pakistan", 33.68, 73.05, [r"pakistan(i)?s?", r"pakistanais(e)?", r"islamabad", r"karachi", r"lahore"]),
    "AFG": ("Afghanistan", 34.53, 69.17, [r"afghan(istan)?s?", r"kabul|kaboul", r"taliban(s)?"]),
    "BGD": ("Bangladesh", 23.81, 90.41, [r"bangladesh(i)?", r"dhaka"]),
    "LKA": ("Sri Lanka", 6.93, 79.85, [r"sri lanka(n)?", r"colombo"]),
    "NPL": ("Népal", 27.72, 85.32, [r"nepal(i)?", r"népal(ais(e)?s?)?", r"kathmandu|katmandou"]),
    "CHN": ("Chine", 39.90, 116.40, [r"china", r"chinese", r"chine", r"chinois(e)?s?", r"beijing|pékin", r"shanghai", r"\bxi jinping\b", r"\bpboc\b", r"shenzhen", r"hong kong", r"hongkongais"]),
    "TWN": ("Taïwan", 25.03, 121.57, [r"taiwan(ese)?", r"taïwan(ais(e)?s?)?", r"taipei", r"taiwan strait|détroit de taïwan"]),
    "JPN": ("Japon", 35.68, 139.69, [r"japan(ese)?", r"japon(ais(e)?s?)?", r"tokyo", r"osaka", r"\bboj\b", r"bank of japan", r"nikkei"]),
    "KOR": ("Corée du Sud", 37.57, 126.98, [r"south korea(n)?", r"corée du sud", r"sud-coréen(ne)?s?", r"seoul|séoul"]),
    "PRK": ("Corée du Nord", 39.04, 125.76, [r"north korea(n)?", r"corée du nord", r"nord-coréen(ne)?s?", r"pyongyang", r"kim jong"]),
    "MNG": ("Mongolie", 47.89, 106.91, [r"mongolia(n)?", r"mongolie", r"ulaanbaatar|oulan-bator"]),
    "VNM": ("Viêt Nam", 21.03, 105.85, [r"vietnam(ese)?", r"viêt nam|vietnamien(ne)?s?", r"hanoi", r"ho chi minh"]),
    "THA": ("Thaïlande", 13.76, 100.50, [r"thailand", r"\bthai\b", r"tha(ï|i)lande", r"thaïlandais(e)?s?", r"bangkok"]),
    "MMR": ("Birmanie", 19.76, 96.08, [r"myanmar", r"birmanie", r"burm(a|ese)", r"naypyidaw", r"yangon|rangoun"]),
    "KHM": ("Cambodge", 11.56, 104.93, [r"cambodia(n)?", r"cambodg(e|ien(ne)?s?)", r"phnom penh"]),
    "MYS": ("Malaisie", 3.14, 101.69, [r"malaysia(n)?", r"malaisie", r"kuala lumpur"]),
    "SGP": ("Singapour", 1.29, 103.85, [r"singapore(an)?", r"singapour(ien(ne)?s?)?"]),
    "IDN": ("Indonésie", -6.21, 106.85, [r"indonesia(n)?", r"indonési(e|en(ne)?s?)", r"jakarta"]),
    "PHL": ("Philippines", 14.60, 120.98, [r"philippine(s)?", r"filipino(s)?", r"manila|manille", r"south china sea|mer de chine méridionale"]),
    "AUS": ("Australie", -35.28, 149.13, [r"australia(n)?", r"australi(e|en(ne)?s?)", r"canberra", r"sydney", r"melbourne", r"\brba\b"]),
    "NZL": ("Nouvelle-Zélande", -41.29, 174.78, [r"new zealand", r"nouvelle-zélande", r"wellington", r"auckland"]),
    "KAZ": ("Kazakhstan", 51.17, 71.43, [r"kazakh(stan)?", r"astana", r"almaty"]),
    "ARM": ("Arménie", 40.18, 44.51, [r"armenia(n)?", r"arméni(e|en(ne)?s?)", r"yerevan|erevan"]),
    "AZE": ("Azerbaïdjan", 40.41, 49.87, [r"azerbaijan(i)?", r"azerba(ï|i)djan(ais(e)?s?)?", r"baku|bakou"]),
    "GEO": ("Géorgie", 41.72, 44.79, [r"tbilisi|tbilissi"]),
    # Institutions européennes (pas un pays : pas de contour sur le globe)
    "EUU": ("Union européenne", 50.85, 4.35, [r"european union", r"union européenne", r"\bEU\b", r"\bUE\b", r"european commission", r"commission européenne",
                                               r"eurozone", r"zone euro", r"euro area", r"\becb\b", r"\bbce\b", r"lagarde", r"von der leyen"]),
}

# Villes précises (prioritaires sur la capitale du pays quand elles sont citées)
CITIES: list[tuple[str, str, str, float, float]] = [
    (r"ecb|bce|lagarde", "EUU", "BCE (Francfort)", 50.11, 8.68),
    (r"gaza", "PSX", "Gaza", 31.50, 34.47), (r"west bank|cisjordanie", "PSX", "Cisjordanie", 31.95, 35.30),
    (r"kharkiv", "UKR", "Kharkiv", 49.99, 36.23), (r"odesa|odessa", "UKR", "Odessa", 46.48, 30.73),
    (r"donbas(s)?|donetsk", "UKR", "Donbass", 48.02, 37.80), (r"zaporizhzhia", "UKR", "Zaporijia", 47.84, 35.14),
    (r"hormuz|ormuz", "IRN", "Détroit d'Ormuz", 26.57, 56.25), (r"red sea|mer rouge", "YEM", "Mer Rouge", 15.50, 41.50),
    (r"suez", "EGY", "Canal de Suez", 30.58, 32.27), (r"taiwan strait|détroit de taïwan", "TWN", "Détroit de Taïwan", 24.50, 119.50),
    (r"south china sea|mer de chine méridionale", "PHL", "Mer de Chine méridionale", 12.00, 114.00),
    (r"shanghai", "CHN", "Shanghai", 31.23, 121.47), (r"hong kong", "CHN", "Hong Kong", 22.32, 114.17), (r"shenzhen", "CHN", "Shenzhen", 22.54, 114.06),
    (r"new york|wall street", "USA", "New York", 40.71, -74.01), (r"frankfurt|francfort", "DEU", "Francfort", 50.11, 8.68),
    (r"mumbai|bombay", "IND", "Bombay", 19.08, 72.88), (r"istanbul", "TUR", "Istanbul", 41.01, 28.98), (r"dubai|dubaï", "ARE", "Dubaï", 25.20, 55.27),
    (r"darfur|darfour", "SDN", "Darfour", 13.50, 24.00), (r"goma", "COD", "Goma", -1.68, 29.22), (r"tigray", "ETH", "Tigré", 14.03, 38.32),
    (r"aleppo|alep", "SYR", "Alep", 36.20, 37.13), (r"benghazi", "LBY", "Benghazi", 32.12, 20.07), (r"lagos", "NGA", "Lagos", 6.52, 3.38),
    (r"karachi", "PAK", "Karachi", 24.86, 67.01), (r"osaka", "JPN", "Osaka", 34.69, 135.50), (r"toronto", "CAN", "Toronto", 43.65, -79.38),
    (r"são paulo|sao paulo", "BRA", "São Paulo", -23.55, -46.63), (r"sydney", "AUS", "Sydney", -33.87, 151.21), (r"davos", "CHE", "Davos", 46.80, 9.84),
    (r"zurich", "CHE", "Zurich", 47.38, 8.54), (r"geneva|genève", "CHE", "Genève", 46.20, 6.14), (r"milan", "ITA", "Milan", 45.46, 9.19),
]

# Zones de conflit et points de passage : quand elles sont citées dans le titre, elles priment sur le premier pays nommé
HOTSPOTS = {"Gaza", "Cisjordanie", "Kharkiv", "Odessa", "Donbass", "Zaporijia", "Détroit d'Ormuz", "Mer Rouge", "Canal de Suez", "Détroit de Taïwan",
            "Mer de Chine méridionale", "Darfour", "Goma", "Tigré", "Alep", "Benghazi"}

# Termes qui désignent les États-Unis sans les nommer : utilisés seulement si aucun autre lieu n'est cité.
WEAK = {"USA": [r"\bU\.S\.", r"\bUS\b", r"\btrump\b"]}


def _compile(p: str) -> re.Pattern:
    # majuscule dans le motif = sensible à la casse (\bUS\b, \bTurkey\b) ; sinon insensible
    flags = 0 if re.search(r"[A-Z]", p.replace(r"\b", "")) else re.IGNORECASE
    return re.compile(p if p.startswith(r"\b") else rf"(?<![\w-])(?:{p})(?![\w])", flags)


_COUNTRY_RX = [(iso, _compile(p)) for iso, (_, _, _, pats) in COUNTRIES.items() for p in pats]
_CITY_RX = [(_compile(p), iso, name, lat, lon) for p, iso, name, lat, lon in CITIES]
_WEAK_RX = [(iso, _compile(p)) for iso, pats in WEAK.items() for p in pats]


@dataclass
class Place:
    iso: str
    country: str
    label: str
    lat: float
    lon: float


def geolocate(title: str, summary: str = "") -> Place | None:
    """Lieu principal d'une actualité : premier pays cité dans le titre, sinon dans le résumé ;
    une ville connue de ce pays affine la position. Rien si aucun lieu n'est reconnu."""
    for rx, iso, city, lat, lon in _CITY_RX:
        if city in HOTSPOTS and title and rx.search(title):
            return Place(iso, COUNTRIES[iso][0], city, lat, lon)
    for text in (title, summary):
        if not text:
            continue
        hits = [(m.start(), iso) for iso, rx in _COUNTRY_RX if (m := rx.search(text))]
        if not hits:
            continue
        iso = min(hits)[1]
        name, lat, lon, _ = COUNTRIES[iso]
        for rx, c_iso, city, c_lat, c_lon in _CITY_RX:
            if c_iso == iso and (rx.search(title) or rx.search(summary or "")):
                return Place(iso, name, city, c_lat, c_lon)
        return Place(iso, name, name, lat, lon)
    for text in (title, summary):
        for iso, rx in _WEAK_RX:
            if text and rx.search(text):
                name, lat, lon, _ = COUNTRIES[iso]
                return Place(iso, name, name, lat, lon)
    return None

# ───────────────────────────── Classement ─────────────────────────────

RISK = re.compile(r"\b(war|wars|warfare|attack(s|ed)?|air ?strikes?|drone strikes?|strikes? (on|in|against|hit\w*)|kill(s|ed|ing)?|shooting|gunmen|raids?|missiles?|bombing|bombard\w*|shelling|invasion|invade[sd]?|troops|military|"
                  r"ceasefire|truce|hostages?|terror\w*|coup|insurgen\w*|rebels?|militia\w*|killed|kills|dead|death toll|massacre|explosions?|nuclear|"
                  r"sanctions?|blockade|conflict|clashes|armed|weapons?|navy|naval|"
                  r"guerre|attaques?|attentat\w*|frappes?|bombardements?|armée|militaires?|cessez-le-feu|trêve|otages?|terroris\w*|coup d'[ée]tat|"
                  r"rebelles?|milices?|tu[ée]s|morts?|explosions?|nucléaire|blocus|conflit|affrontements|armes?|soldats?)\b", re.IGNORECASE)
CRITICAL = re.compile(r"\b(kill(s|ed|ing)?|strikes? (on|in|against)|dead|death toll|massacre|invasion|nuclear|missiles?|air ?strikes?|bombing|explosions?|"
                      r"tu[ée]s|morts|massacre|nucléaire|frappes?|bombardements?|attentat\w*)\b", re.IGNORECASE)
ECON = re.compile(r"\b(econom\w*|inflation|tariffs?|trade|gdp|growth|recession|central bank|interest rates?|rate (cut|hike)s?|oil|crude|gas|lng|opec|"
                  r"currency|debt|bonds?|budget|exports?|imports?|markets?|stocks?|shares|investment|jobs|unemployment|"
                  r"économi\w*|croissance|récession|droits de douane|commerce|pib|banque centrale|taux|pétrole|gaz|opep|devise|dette|"
                  r"obligations?|budget|exportations?|importations?|marchés?|bourse|investissements?|emploi|chômage)\b", re.IGNORECASE)
EVENT = re.compile(r"\b(tensions?|diplomat\w*|talks|negotiations?|pourparlers|négociations?|elections?|vote[sd]?|voting|summit|protests?|demonstrat\w*|resign\w*|referendum|parliament|impeach\w*|state of emergency|"
                   r"earthquake|flood\w*|hurricane|typhoon|cyclone|wildfires?|"
                   r"élections?|scrutin|sommet|manifestations?|démission\w*|référendum|parlement|destitution|état d'urgence|"
                   r"séisme|tremblement de terre|inondations?|ouragan|typhon|cyclone|incendies?)\b", re.IGNORECASE)


def classify(title: str, summary: str = "") -> tuple[str, bool] | None:
    """(catégorie, critique) d'une actualité internationale : risk (rouge), event (orange), econ (bleu) ; None sinon.
    Le risque l'emporte ; « critique » = victimes, frappes, nucléaire ou invasion, cité dans le titre."""
    text = f"{title} {summary}"
    if RISK.search(title) or (RISK.search(summary or "") and not ECON.search(title)):
        return "risk", bool(CRITICAL.search(title))
    if EVENT.search(text):
        return "event", False
    if ECON.search(text):
        return "econ", False
    return None

# ───────────────────────────── Places financières et devises du calendrier ─────────────────────────────

# (code, ville, pays ADM0_A3, lat, lon, place, symbole Yahoo de l'indice phare, libellé)
CENTERS = [
    ("NYC", "New York", "USA", 40.71, -74.01, "NYSE · Nasdaq", "^GSPC", "S&P 500"),
    ("TOR", "Toronto", "CAN", 43.65, -79.38, "TSX", "^GSPTSE", "S&P/TSX"),
    ("SAO", "São Paulo", "BRA", -23.55, -46.63, "B3", "^BVSP", "Bovespa"),
    ("MEX", "Mexico", "MEX", 19.43, -99.13, "BMV", "^MXX", "IPC"),
    ("LON", "Londres", "GBR", 51.51, -0.09, "LSE", "^FTSE", "FTSE 100"),
    ("PAR", "Paris", "FRA", 48.87, 2.34, "Euronext Paris", "^FCHI", "CAC 40"),
    ("FRA", "Francfort", "DEU", 50.11, 8.68, "Xetra", "^GDAXI", "DAX"),
    ("AMS", "Amsterdam", "NLD", 52.37, 4.89, "Euronext Amsterdam", "^AEX", "AEX"),
    ("ZRH", "Zurich", "CHE", 47.37, 8.54, "SIX", "^SSMI", "SMI"),
    ("MIL", "Milan", "ITA", 45.46, 9.19, "Borsa Italiana", "FTSEMIB.MI", "FTSE MIB"),
    ("MAD", "Madrid", "ESP", 40.42, -3.70, "BME", "^IBEX", "IBEX 35"),
    ("TYO", "Tokyo", "JPN", 35.68, 139.77, "JPX", "^N225", "Nikkei 225"),
    ("HKG", "Hong Kong", "CHN", 22.28, 114.16, "HKEX", "^HSI", "Hang Seng"),
    ("SHA", "Shanghai", "CHN", 31.23, 121.47, "SSE", "000001.SS", "Shanghai Comp."),
    ("SEL", "Séoul", "KOR", 37.57, 126.98, "KRX", "^KS11", "KOSPI"),
    ("TPE", "Taipei", "TWN", 25.03, 121.57, "TWSE", "^TWII", "TAIEX"),
    ("BOM", "Bombay", "IND", 19.08, 72.88, "NSE", "^NSEI", "Nifty 50"),
    ("SYD", "Sydney", "AUS", -33.87, 151.21, "ASX", "^AXJO", "ASX 200"),
    ("SIN", "Singapour", "SGP", 1.28, 103.85, "SGX", "^STI", "STI"),
    ("JNB", "Johannesburg", "ZAF", -26.20, 28.05, "JSE", "^J203.JO", "JSE All Share"),
    ("RUH", "Riyad", "SAU", 24.71, 46.68, "Tadawul", "^TASI.SR", "TASI"),
]

# Devise du calendrier économique -> lieu de publication (banque centrale / institut statistique)
CURRENCY_PLACE = {
    "USD": ("USA", "Washington", 38.90, -77.04), "EUR": ("DEU", "Francfort (BCE)", 50.11, 8.68), "GBP": ("GBR", "Londres", 51.51, -0.13),
    "JPY": ("JPN", "Tokyo", 35.68, 139.69), "CAD": ("CAN", "Ottawa", 45.42, -75.70), "AUD": ("AUS", "Sydney", -33.87, 151.21),
    "NZD": ("NZL", "Wellington", -41.29, 174.78), "CNY": ("CHN", "Pékin", 39.90, 116.40), "CHF": ("CHE", "Zurich", 47.37, 8.54),
}

# Noms français des pays absents de COUNTRIES (non géolocalisés dans les titres, mais présents dans GDELT)
OTHER_NAMES = {
    "BHR": "Bahreïn", "MLT": "Malte", "CYP": "Chypre", "LTU": "Lituanie", "LVA": "Lettonie", "EST": "Estonie", "TTO": "Trinité-et-Tobago",
    "HKG": "Hong Kong", "MAC": "Macao", "BIH": "Bosnie-Herzégovine", "ALB": "Albanie", "MKD": "Macédoine du Nord", "MNE": "Monténégro",
    "KOS": "Kosovo", "SVK": "Slovaquie", "SVN": "Slovénie", "HRV": "Croatie", "BGR": "Bulgarie", "CZE": "Tchéquie", "ISL": "Islande",
    "LUX": "Luxembourg", "MDA": "Moldavie", "JAM": "Jamaïque", "DOM": "République dominicaine", "GTM": "Guatemala", "HND": "Honduras",
    "SLV": "Salvador", "NIC": "Nicaragua", "CRI": "Costa Rica", "PAN": "Panama", "PRY": "Paraguay", "URY": "Uruguay", "GUY": "Guyana",
    "SUR": "Suriname", "BLZ": "Belize", "BHS": "Bahamas", "PRI": "Porto Rico", "LAO": "Laos", "BRN": "Brunei", "TLS": "Timor oriental",
    "PNG": "Papouasie-Nouvelle-Guinée", "FJI": "Fidji", "KGZ": "Kirghizistan", "TJK": "Tadjikistan", "TKM": "Turkménistan",
    "UZB": "Ouzbékistan", "UGA": "Ouganda", "TZA": "Tanzanie", "ZMB": "Zambie", "ZWE": "Zimbabwe", "MWI": "Malawi", "BWA": "Botswana",
    "NAM": "Namibie", "LSO": "Lesotho", "SWZ": "Eswatini", "CMR": "Cameroun", "GAB": "Gabon", "COG": "Congo", "CAF": "Centrafrique",
    "BEN": "Bénin", "TGO": "Togo", "GIN": "Guinée", "SLE": "Sierra Leone", "LBR": "Liberia", "GMB": "Gambie", "GNB": "Guinée-Bissau",
    "MRT": "Mauritanie", "ERI": "Érythrée", "DJI": "Djibouti", "BDI": "Burundi", "SAH": "Sahara occidental", "MUS": "Maurice",
    "MDV": "Maldives", "BTN": "Bhoutan", "GNQ": "Guinée équatoriale", "SGP": "Singapour", "NCL": "Nouvelle-Calédonie", "FLK": "Malouines",
    "SYC": "Seychelles", "CPV": "Cap-Vert", "COM": "Comores", "SSD": "Soudan du Sud",
}


# ───────────────────────────── Points chauds et actifs exposés ─────────────────────────────

@dataclass(frozen=True)
class Zone:
    key: str
    name: str
    isos: tuple[str, ...]          # pays (ADM0_A3) dont les événements alimentent la zone
    lat: float
    lon: float
    alt: float                     # altitude de caméra pour cadrer la zone
    assets: tuple[tuple[str, str, str], ...]  # (symbole Yahoo, libellé, canal d'exposition)


# Zones géopolitiques suivies et actifs qui réagissent le plus directement à leur actualité.
# Choix éditorial (canaux de transmission connus), pas une estimation statistique.
ZONES = [
    Zone("gulf", "Moyen-Orient et Golfe", ("IRN", "ISR", "PSX", "LBN", "SYR", "IRQ", "YEM", "SAU", "ARE", "QAT", "KWT", "OMN", "JOR"), 29.0, 45.0, 1.1,
         (("BZ=F", "Brent", "Offre de brut, détroit d'Ormuz"), ("GC=F", "Or", "Valeur refuge"), ("ILS=X", "USD/ILS", "Prime de risque israélienne"),
          ("TA35.TA", "TA-35", "Actions israéliennes"), ("XLE", "Énergie US (XLE)", "Pétrolières"), ("ITA", "Défense US (ITA)", "Dépenses militaires"))),
    Zone("ukr", "Russie – Ukraine", ("RUS", "UKR", "BLR", "MDA"), 50.0, 35.0, 1.15,
         (("TTF=F", "Gaz européen (TTF)", "Approvisionnement gazier de l'Europe"), ("ZW=F", "Blé", "Exportations de la mer Noire"),
          ("ZC=F", "Maïs", "Exportations ukrainiennes"), ("RHM.DE", "Rheinmetall", "Réarmement européen"), ("^STOXX50E", "Euro Stoxx 50", "Exposition de l'Europe"),
          ("RUB=X", "USD/RUB", "Rouble"))),
    Zone("taiwan", "Taïwan et mer de Chine", ("TWN", "CHN", "PHL"), 23.5, 121.0, 1.05,
         (("TSM", "TSMC", "Premier fondeur mondial de puces"), ("^SOX", "Semi-conducteurs (SOX)", "Chaîne d'approvisionnement"),
          ("^TWII", "TAIEX", "Actions taïwanaises"), ("TWD=X", "USD/TWD", "Dollar taïwanais"), ("CNH=X", "USD/CNH", "Yuan offshore"), ("^HSI", "Hang Seng", "Actions chinoises"))),
    Zone("redsea", "Mer Rouge et Corne de l'Afrique", ("YEM", "EGY", "SDN", "ERI", "DJI", "SOM", "ETH"), 16.0, 41.0, 1.15,
         (("MAERSK-B.CO", "Maersk", "Détournements par le cap de Bonne-Espérance"), ("ZIM", "ZIM", "Taux de fret conteneurs"),
          ("BZ=F", "Brent", "Transit pétrolier par Suez"), ("EGP=X", "USD/EGP", "Recettes du canal de Suez"))),
    Zone("korea", "Péninsule coréenne", ("PRK", "KOR"), 38.0, 127.5, 1.0,
         (("^KS11", "KOSPI", "Actions sud-coréennes"), ("005930.KS", "Samsung", "Mémoire et électronique"), ("KRW=X", "USD/KRW", "Won"))),
    Zone("southasia", "Inde – Pakistan", ("IND", "PAK", "AFG"), 29.0, 72.0, 1.15,
         (("^NSEI", "Nifty 50", "Actions indiennes"), ("INR=X", "USD/INR", "Roupie"), ("GC=F", "Or", "Valeur refuge"))),
    Zone("latam", "Venezuela et Caraïbes", ("VEN", "COL", "CUB", "HTI"), 9.0, -70.0, 1.2,
         (("CL=F", "WTI", "Brut lourd vénézuélien"), ("CVX", "Chevron", "Seul grand producteur américain sur place"))),
    Zone("sahel", "Sahel et golfe de Guinée", ("MLI", "BFA", "NER", "TCD", "NGA", "CMR"), 13.0, 5.0, 1.3,
         (("GC=F", "Or", "Mines d'or sahéliennes"), ("BZ=F", "Brent", "Production nigériane"))),
]
ZONE_SYMBOLS = list(dict.fromkeys(sym for z in ZONES for sym, _, _ in z.assets))


# ───────────────────────────── Regroupement des articles sur un même sujet ─────────────────────────────

_STOP = set("a an the of in on at to for and or with by from as is are was were be been after over amid says said new us u s "
            "le la les un une des du de d l et en au aux pour par sur dans avec selon après est sont a été".split())


def _words(title: str) -> set[str]:
    return {w for w in re.findall(r"[a-zà-ÿ0-9]+", title.lower()) if len(w) > 2 and w not in _STOP}


def cluster(items: list[dict], threshold: float = 0.45, window_h: float = 36) -> list[dict]:
    """Regroupe les articles qui racontent le même événement (titres proches, publiés à moins de `window_h` heures).

    `items` triés du plus récent au plus ancien, chacun avec title, source, published (ISO). Renvoie un article
    représentatif par sujet (le plus récent) enrichi de `sources` (nombre de médias) et `others` (autres titres / médias).
    """
    groups: list[dict] = []
    for it in items:
        w, t = _words(it["title"]), datetime.fromisoformat(it["published"])
        for g in groups:
            if abs((g["_t"] - t).total_seconds()) > window_h * 3600 or not w:
                continue
            inter = len(w & g["_w"])
            if inter >= 3 and inter / min(len(w), len(g["_w"])) >= threshold:
                g["_w"] |= w
                if it["source"] not in g["_src"]:
                    g["_src"].add(it["source"])
                    g["others"].append({"source": it["source"], "title": it["title"], "link": it["link"]})
                break
        else:
            groups.append({**it, "_w": set(w), "_t": t, "_src": {it["source"]}, "others": []})
    out = []
    for g in groups:
        g["sources"] = len(g.pop("_src"))
        g.pop("_w"); g.pop("_t")
        out.append(g)
    return out


# ───────────────────────────── Liens ─────────────────────────────

# Grands corridors : référence structurelle (géographie des routes), sans volume. Source : EIA « World Oil Transit Chokepoints »,
# IEA Gas Market Report, OMC (principaux partenaires commerciaux). Coordonnées : terminaux / ports principaux.
ENERGY_ROUTES = [
    ("Golfe Persique → Chine (brut, via Ormuz et Malacca)", (26.64, 50.16), (29.87, 121.55)),
    ("Golfe Persique → Japon / Corée (brut)", (26.64, 50.16), (35.45, 139.64)),
    ("Golfe Persique → Inde (brut)", (26.64, 50.16), (22.47, 70.05)),
    ("Qatar → Asie (GNL, Ras Laffan)", (25.93, 51.53), (35.45, 139.64)),
    ("Qatar → Europe (GNL, via Suez)", (25.93, 51.53), (51.95, 4.13)),
    ("États-Unis → Europe (GNL, golfe du Mexique)", (29.73, -93.87), (51.95, 4.13)),
    ("Norvège → Europe continentale (gaz, gazoducs)", (60.80, 3.50), (53.55, 8.10)),
    ("Russie → Chine (gaz, Power of Siberia)", (60.80, 117.00), (49.60, 117.40)),
    ("Russie → Inde (brut, Baltique / mer Noire)", (44.72, 37.77), (22.47, 70.05)),
    ("Afrique de l'Ouest → Europe (brut, golfe de Guinée)", (4.40, 7.10), (51.95, 4.13)),
    ("Brésil → Chine (brut)", (-22.90, -43.20), (29.87, 121.55)),
    ("Canada → États-Unis (brut, oléoducs)", (56.73, -111.38), (41.88, -87.63)),
]
TRADE_ROUTES = [
    ("Chine ↔ États-Unis", (31.23, 121.47), (33.74, -118.27)),
    ("Chine ↔ Union européenne", (31.23, 121.47), (51.95, 4.13)),
    ("États-Unis ↔ Union européenne", (40.67, -74.04), (51.95, 4.13)),
    ("États-Unis ↔ Mexique", (32.54, -117.03), (19.43, -99.13)),
    ("États-Unis ↔ Canada", (42.31, -83.04), (43.65, -79.38)),
    ("Chine ↔ Japon", (31.23, 121.47), (35.45, 139.64)),
    ("Chine ↔ Corée du Sud", (31.23, 121.47), (35.10, 129.04)),
    ("Chine ↔ ASEAN (Singapour)", (22.54, 114.06), (1.26, 103.84)),
    ("Union européenne ↔ Royaume-Uni", (51.95, 4.13), (51.51, 0.05)),
    ("Chine ↔ Australie (minerais)", (-20.31, 118.58), (31.23, 121.47)),
    ("Inde ↔ Émirats arabes unis", (18.95, 72.95), (25.01, 55.06)),
    ("Brésil ↔ Chine (soja, minerai)", (-23.95, -46.33), (31.23, 121.47)),
]


def correlations(series: dict[str, list[tuple[str, float]]], window: int = 60, min_obs: int = 30) -> list[tuple[str, str, float, int]]:
    """Corrélation des rendements journaliers (log) entre places, sur les `window` dernières dates communes.
    `series` : code -> [(date ISO, clôture)]. Retourne (a, b, corrélation, nombre d'observations)."""
    rets: dict[str, dict[str, float]] = {}
    for code, pts in series.items():
        pts = sorted(p for p in pts if p[1] and p[1] > 0)
        rets[code] = {d2: math.log(c2 / c1) for (_, c1), (d2, c2) in zip(pts, pts[1:])}
    codes, out = sorted(rets), []
    for i, a in enumerate(codes):
        for b in codes[i + 1:]:
            common = sorted(set(rets[a]) & set(rets[b]))[-window:]
            if len(common) < min_obs:
                continue
            x, y = np.array([rets[a][d] for d in common]), np.array([rets[b][d] for d in common])
            if x.std() == 0 or y.std() == 0:
                continue
            out.append((a, b, float(np.corrcoef(x, y)[0, 1]), len(common)))
    return out
