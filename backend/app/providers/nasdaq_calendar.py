"""Chiffres réels des publications économiques : calendrier économique de Nasdaq (API publique du site).

ForexFactory donne l'heure, l'importance, le consensus et le précédent, mais pas le chiffre publié.
Nasdaq le donne, avec ses propres libellés : on rapproche les deux par zone, heure exacte, titre,
consensus et précédent (voir `match`).

Particularités observées : les heures de la colonne « gmt » sont celles de New York, et la page
`date=J` peut contenir la journée new-yorkaise J-1. On essaie donc les deux dates pour chaque ligne :
l'heure exacte exigée au rapprochement élimine la mauvaise.
"""
import html
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from ..cache import SourceError
from .http import get

URL = "https://api.nasdaq.com/api/calendar/economicevents"
NY = ZoneInfo("America/New_York")
# pays Nasdaq -> devise utilisée par ForexFactory
ZONE = {
    "United States": "USD", "Euro Zone": "EUR", "Germany": "EUR", "France": "EUR", "Italy": "EUR", "Spain": "EUR",
    "Netherlands": "EUR", "Belgium": "EUR", "Austria": "EUR", "Portugal": "EUR", "Ireland": "EUR", "Greece": "EUR", "Finland": "EUR",
    "United Kingdom": "GBP", "Japan": "JPY", "China": "CNY", "Canada": "CAD", "Australia": "AUD", "New Zealand": "NZD", "Switzerland": "CHF",
}


class NasdaqCalendar:
    name = "Nasdaq (calendrier économique)"

    def page(self, d: date) -> list[dict]:
        """Lignes de la page `date=d` avec un chiffre publié ; `times` = heures UTC possibles (journée d ou d-1 à New York)."""
        r = get(URL, params={"date": d.isoformat()}, headers={"Accept": "application/json"}).json()
        if not isinstance(r, dict) or "data" not in r:
            raise SourceError("Nasdaq : réponse inattendue")
        rows = (r["data"] or {}).get("rows") or []  # data = None : « No record found » (jour sans publication)
        out = []
        for x in rows:
            actual = _clean(x.get("actual"))
            cur = ZONE.get(x.get("country", ""))
            m = re.match(r"^(\d{1,2}):(\d{2})$", (x.get("gmt") or "").strip())
            if not actual or not cur or not m:
                continue
            times = [datetime(dd.year, dd.month, dd.day, int(m[1]), int(m[2]), tzinfo=NY).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
                     for dd in (d - timedelta(days=1), d)]
            out.append({"country": cur, "title": _clean(x.get("eventName")), "times": times,
                        "actual": actual, "consensus": _clean(x.get("consensus")), "previous": _clean(x.get("previous"))})
        return out


def _clean(s) -> str:
    s = html.unescape(html.unescape(s or "")).replace("\xa0", " ").strip()
    return s


# --- rapprochement ForexFactory <-> Nasdaq ---------------------------------------------------------

NUM = re.compile(r"^(-?\d+(?:\.\d+)?)\s*([%KMBT]?)$")
STOP = {"m", "y", "q", "mom", "yoy", "qoq", "the", "of", "and", "us", "u", "german", "french", "italian", "spanish",
        "uk", "china", "chinese", "japan", "japanese", "canadian", "australian", "swiss", "ecb", "boe", "boj", "rba", "boc", "snb", "rbnz", "pboc", "fed"}


def num(s: str):
    m = NUM.match((s or "").replace(",", "").strip())
    return (float(m[1]), m[2]) if m else None


ALIAS = {"uom": "michigan"}  # libellés ForexFactory -> Nasdaq


def _tokens(t: str) -> set[str]:
    t = re.sub(r"(\d+)\s*-\s*(y|yr|year|m|month)\b", r"\1\2", t.lower())
    return {ALIAS.get(w, w) for w in re.findall(r"[a-z0-9]+", t) if w not in STOP}


def _score(ev: dict, row: dict) -> float | None:
    """Plausibilité qu'une ligne Nasdaq soit la publication ForexFactory `ev` (None = exclue)."""
    if row["country"] != ev["country"] or ev["time"][:16] not in row["times"]:
        return None
    a, b = _tokens(ev["title"]), _tokens(row["title"])
    common = len(a & b)
    if not common:
        return None
    s = common / len(a | b)
    act = num(row["actual"])
    # consensus identique : signal fort (deux variantes m/m et a/a ont rarement le même) ; il peut différer d'une source à l'autre
    for mine, theirs, w_eq, w_ne in ((ev["forecast"], row["consensus"], 3.0, -1.0), (ev["previous"], row["previous"], 1.0, -1.0)):
        x, y = num(mine), num(theirs)
        if x and not y and w_eq == 3.0:
            s -= 0.5  # ForexFactory a un consensus, la ligne Nasdaq non : souvent la variante secondaire (n.s.a., a/a…)
        if not x or not y:
            continue
        if x[1] != y[1]:
            return None  # unités incompatibles (% contre niveau…)
        tol = max(abs(x[0]) * 0.25, 0.2)  # le précédent peut avoir été révisé
        s += w_eq if abs(x[0] - y[0]) <= (1e-9 if w_eq == 3.0 else tol) else w_ne
    f = num(ev["forecast"]) or num(ev["previous"])
    if f and act and f[1] != act[1]:
        return None
    return s


def match(events: list[dict], rows: list[dict]) -> dict[str, str]:
    """id ForexFactory -> chiffre réel Nasdaq, chaque ligne Nasdaq servant au plus une fois.

    Une publication dont les deux meilleures lignes candidates sont à égalité est laissée sans chiffre :
    mieux vaut « n.d. » qu'un chiffre attribué au hasard.
    """
    pairs = []
    for i, ev in enumerate(events):
        cand = sorted(((sc, j) for j, row in enumerate(rows) if (sc := _score(ev, row)) is not None and sc >= 0.3), reverse=True)
        if not cand or (len(cand) > 1 and cand[0][0] - cand[1][0] < 0.05 and rows[cand[0][1]]["actual"] != rows[cand[1][1]]["actual"]):
            continue
        pairs += [(sc, i, j) for sc, j in cand]
    pairs.sort(reverse=True)
    used_e, used_r, out = set(), set(), {}
    for sc, i, j in pairs:
        if i in used_e or j in used_r:
            continue
        used_e.add(i); used_r.add(j)
        out[events[i]["id"]] = rows[j]["actual"]
    return out
