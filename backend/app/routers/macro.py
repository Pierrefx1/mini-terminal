from datetime import date

from fastapi import APIRouter, HTTPException

from ..cache import cached
from ..providers.registry import macro, policy, treasury

router = APIRouter(prefix="/api/macro", tags=["macro"])

# Indicateurs US (FRED). transform : lin = niveau, pc1 = variation sur un an en %, chg = variation de période.
INDICATORS = [
    {"key": "cpi", "id": "CPIAUCSL", "transform": "pc1", "label": "Inflation CPI", "unit": "% sur un an", "group": "Inflation"},
    {"key": "core_cpi", "id": "CPILFESL", "transform": "pc1", "label": "CPI sous-jacent", "unit": "% sur un an", "group": "Inflation"},
    {"key": "pce", "id": "PCEPI", "transform": "pc1", "label": "Inflation PCE", "unit": "% sur un an", "group": "Inflation"},
    {"key": "core_pce", "id": "PCEPILFE", "transform": "pc1", "label": "PCE sous-jacent", "unit": "% sur un an", "group": "Inflation"},
    {"key": "breakeven", "id": "T10YIE", "transform": "lin", "label": "Point mort d'inflation 10 ans", "unit": "%", "group": "Inflation"},
    {"key": "unrate", "id": "UNRATE", "transform": "lin", "label": "Taux de chômage", "unit": "%", "group": "Emploi"},
    {"key": "payrolls", "id": "PAYEMS", "transform": "chg", "label": "Créations d'emplois (NFP)", "unit": "milliers / mois", "group": "Emploi"},
    {"key": "claims", "id": "ICSA", "transform": "lin", "label": "Inscriptions hebdo au chômage", "unit": "nombre", "group": "Emploi"},
    {"key": "wages", "id": "CES0500000003", "transform": "pc1", "label": "Salaire horaire moyen", "unit": "% sur un an", "group": "Emploi"},
    {"key": "gdp", "id": "A191RL1Q225SBEA", "transform": "lin", "label": "PIB réel", "unit": "% trim. annualisé", "group": "Activité"},
    {"key": "indpro", "id": "INDPRO", "transform": "pc1", "label": "Production industrielle", "unit": "% sur un an", "group": "Activité"},
    {"key": "retail", "id": "RSAFS", "transform": "pc1", "label": "Ventes au détail", "unit": "% sur un an", "group": "Activité"},
    {"key": "sentiment", "id": "UMCSENT", "transform": "lin", "label": "Confiance des ménages (Michigan)", "unit": "indice", "group": "Activité"},
    {"key": "dff", "id": "DFF", "transform": "lin", "label": "Fed funds effectif", "unit": "%", "group": "Monétaire"},
    {"key": "dollar", "id": "DTWEXBGS", "transform": "lin", "label": "Dollar (indice large Fed)", "unit": "indice", "group": "Monétaire"},
    {"key": "m2", "id": "M2SL", "transform": "pc1", "label": "Masse monétaire M2", "unit": "% sur un an", "group": "Monétaire"},
]
BY_KEY = {i["key"]: i for i in INDICATORS}


def _years(kind: str, n: int) -> list[dict]:
    this = date.today().year
    rows: list[dict] = []
    for y in range(this - n + 1, this + 1):
        ttl = 3600 if y == this else 30 * 86400
        rows += cached(f"treasury:{kind}:{y}", ttl, treasury.name, lambda y=y: treasury.year(kind, y))["data"]
    return rows


@router.get("/yields")
def yields(years: int = 6):
    """Courbes nominales et réelles quotidiennes sur `years` années."""
    return cached(f"yields:{years}", 3600, treasury.name,
                  lambda: {"nominal": _years("nominal", years), "real": _years("real", years)})


@router.get("/policy")
def policy_rates():
    return cached("policy", 6 * 3600, policy.name, policy.policy_rates)


@router.get("/catalog")
def catalog():
    return INDICATORS


@router.get("/indicator")
def indicator(key: str, start: str = "2000-01-01"):
    ind = BY_KEY.get(key)
    if not ind:
        raise HTTPException(404, f"Indicateur inconnu : {key}")
    return cached(f"fred:{ind['id']}:{ind['transform']}:{start}", 6 * 3600, macro.name,
                  lambda: {**ind, **macro.series(ind["id"], start, ind["transform"])})
