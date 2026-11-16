"""Explorateur d'indicateurs par pays (façon Trading Economics)."""
from fastapi import APIRouter, HTTPException

from ..cache import cached
from ..providers.eurostat import Eurostat
from ..providers.registry import policy
from ..providers.worldbank import WorldBank

router = APIRouter(prefix="/api/data", tags=["data"])
wb, es = WorldBank(), Eurostat()

# code ISO2, nom, code Eurostat (None hors UE), zone BRI des taux directeurs
COUNTRIES = [("US", "États-Unis", None, "US"), ("XC", "Zone euro", "EA20", "XM"), ("FR", "France", "FR", "XM"), ("DE", "Allemagne", "DE", "XM"), ("IT", "Italie", "IT", "XM"),
             ("ES", "Espagne", "ES", "XM"), ("NL", "Pays-Bas", "NL", "XM"), ("BE", "Belgique", "BE", "XM"), ("PT", "Portugal", "PT", "XM"), ("IE", "Irlande", "IE", "XM"),
             ("AT", "Autriche", "AT", "XM"), ("GR", "Grèce", "EL", "XM"), ("FI", "Finlande", "FI", "XM"), ("SE", "Suède", "SE", None), ("DK", "Danemark", "DK", None),
             ("PL", "Pologne", "PL", None), ("GB", "Royaume-Uni", None, "GB"), ("CH", "Suisse", "CH", "CH"), ("NO", "Norvège", "NO", None), ("JP", "Japon", None, "JP"),
             ("CN", "Chine", None, "CN"), ("IN", "Inde", None, None), ("KR", "Corée du Sud", None, None), ("CA", "Canada", None, "CA"), ("AU", "Australie", None, "AU"),
             ("BR", "Brésil", None, None), ("MX", "Mexique", None, None), ("TR", "Turquie", "TR", None), ("ZA", "Afrique du Sud", None, None), ("ID", "Indonésie", None, None),
             ("SA", "Arabie saoudite", None, None)]
C = {c[0]: c for c in COUNTRIES}
# clé, libellé, catégorie, unité, source, code, filtres Eurostat, fréquence
IND = [
    ("gdp_growth", "Croissance du PIB réel", "PIB", "% annuel", "wb", "NY.GDP.MKTP.KD.ZG", None, "A"),
    ("gdp_qoq", "PIB réel, variation trimestrielle", "PIB", "% t/t", "es", "namq_10_gdp", {"unit": "CLV_PCH_PRE", "s_adj": "SCA", "na_item": "B1GQ"}, "T"),
    ("gdp_usd", "PIB nominal", "PIB", "USD courants", "wb", "NY.GDP.MKTP.CD", None, "A"),
    ("gdp_pc", "PIB par habitant", "PIB", "USD courants", "wb", "NY.GDP.PCAP.CD", None, "A"),
    ("industry", "Production industrielle", "PIB", "% sur un an", "es", "sts_inpr_m", {"nace_r2": "B-D", "s_adj": "CA", "unit": "PCH_SM", "indic_bt": "PRD"}, "M"),
    ("population", "Population", "PIB", "habitants", "wb", "SP.POP.TOTL", None, "A"),
    ("cpi", "Inflation (prix à la consommation)", "Inflation", "% annuel", "wb", "FP.CPI.TOTL.ZG", None, "A"),
    ("hicp", "Inflation IPCH", "Inflation", "% sur un an", "es", "prc_hicp_minr", {"coicop18": "TOTAL", "unit": "RCH_A"}, "M"),
    ("unemp", "Taux de chômage (BIT)", "Emploi", "%", "wb", "SL.UEM.TOTL.ZS", None, "A"),
    ("unemp_m", "Taux de chômage mensuel", "Emploi", "%", "es", "une_rt_m", {"s_adj": "SA", "age": "TOTAL", "sex": "T", "unit": "PC_ACT"}, "M"),
    ("ca", "Solde courant", "Commerce", "% du PIB", "wb", "BN.CAB.XOKA.GD.ZS", None, "A"),
    ("ca_q", "Solde courant trimestriel", "Commerce", "% du PIB", "es", "ei_bpm6ca_q", {"bop_item": "CA", "stk_flow": "BAL", "partner": "WRL_REST", "s_adj": "NSA", "unit": "PC_GDP"}, "T"),
    ("exports", "Exportations", "Commerce", "% du PIB", "wb", "NE.EXP.GNFS.ZS", None, "A"),
    ("imports", "Importations", "Commerce", "% du PIB", "wb", "NE.IMP.GNFS.ZS", None, "A"),
    ("debt", "Dette de l'administration centrale", "Dette", "% du PIB", "wb", "GC.DOD.TOTL.GD.ZS", None, "A"),
    ("debt_q", "Dette publique (Maastricht)", "Dette", "% du PIB", "es", "gov_10q_ggdebt", {"sector": "S13", "na_item": "GD", "unit": "PC_GDP"}, "T"),
    ("policy", "Taux directeur", "Taux", "%", "bis", None, None, "J"),
    ("lending", "Taux des prêts bancaires", "Taux", "%", "wb", "FR.INR.LEND", None, "A"),
    ("real_rate", "Taux d'intérêt réel", "Taux", "%", "wb", "FR.INR.RINR", None, "A"),
    ("house", "Prix des logements", "Logement", "% sur un an", "es", "prc_hpi_q", {"purchase": "TOTAL", "unit": "RCH_A"}, "T"),
    ("confidence", "Confiance des consommateurs", "Confiance", "solde d'opinions", "es", "ei_bsco_m", {"indic": "BS-CSMCI", "s_adj": "SA", "unit": "BAL"}, "M"),
]
I = {i[0]: i for i in IND}
WB_CODES = [i[5] for i in IND if i[4] == "wb"]
GEOS = [c[2] for c in COUNTRIES if c[2]]


def _iso(period: str) -> str:
    """Période source -> date ISO de début de période."""
    p = str(period)
    if "-Q" in p:
        y, q = p.split("-Q")
        return f"{y}-{(int(q) - 1) * 3 + 1:02d}-01"
    return p + "-01-01" if len(p) == 4 else p + "-01" if len(p) == 7 else p


def _eurostat(key: str) -> dict:
    i = I[key]
    return cached(f"es:{key}", 12 * 3600, es.name, lambda: es.fetch(i[5], i[6], GEOS))


def _obs(key: str, country: str) -> tuple[list, dict] | None:
    """Observations [[période, valeur]] d'un indicateur pour un pays + enveloppe de la source."""
    i, c = I[key], C[country]
    if i[4] == "wb":
        e = cached(f"wb:{country}", 24 * 3600, wb.name, lambda: wb.fetch([country], WB_CODES))
        obs = e["data"].get(i[5], {}).get(country)
    elif i[4] == "es":
        if not c[2]:
            return None
        e = _eurostat(key)
        obs = e["data"].get(c[2])
    else:
        if not c[3]:
            return None
        e = cached("policy", 6 * 3600, policy.name, policy.policy_rates)
        obs = next((b["steps"] for b in e["data"]["banks"] if b["area"] == c[3]), None)
        if obs and len(obs) > 1 and obs[-1][1] == obs[-2][1]:
            obs = obs[:-1]  # le dernier point ne fait que prolonger le palier : la période affichée est la date du dernier mouvement
    return (obs, e) if obs else None


@router.get("/catalog")
def catalog():
    return {"countries": [{"code": c[0], "name": c[1]} for c in COUNTRIES],
            "indicators": [{"key": i[0], "label": i[1], "category": i[2], "unit": i[3], "freq": i[7]} for i in IND]}


@router.get("/table")
def table(country: str = "FR"):
    if country not in C:
        raise HTTPException(404, "Pays inconnu")
    rows, envs, errors = [], [], []
    for i in IND:
        try:
            r = _obs(i[0], country)
        except HTTPException as ex:
            errors.append(f"{i[1]} : {ex.detail.get('error') if isinstance(ex.detail, dict) else ex.detail}")
            continue
        if not r:
            continue
        obs, e = r
        envs.append(e)
        rows.append({"key": i[0], "label": i[1], "category": i[2], "unit": i[3], "freq": i[7], "source": e["source"], "last": obs[-1][1], "period": obs[-1][0],
                     "previous": obs[-2][1] if len(obs) > 1 else None, "spark": [o[1] for o in obs[-24:]]})
    if not rows and errors:
        raise HTTPException(502, detail={"source": "Data", "error": " ; ".join(dict.fromkeys(errors))})
    stale = [e for e in envs if e["stale"]]
    err = "; ".join(dict.fromkeys(errors + [e["error"] for e in stale]))
    return {"data": {"country": C[country][1], "rows": rows}, "source": " + ".join(dict.fromkeys(e["source"] for e in envs)),
            "fetched_at": min(e["fetched_at"] for e in envs), "stale": bool(err), "error": err or None}


@router.get("/series")
def series(key: str, countries: str = "FR"):
    if key not in I:
        raise HTTPException(404, "Indicateur inconnu")
    i, out, envs = I[key], [], []
    for c in [x for x in countries.split(",") if x in C]:
        r = _obs(key, c)
        if r:
            out.append({"country": c, "name": C[c][1], "obs": [[_iso(p), v, str(p)] for p, v in r[0]]})
            envs.append(r[1])
    if not envs:
        raise HTTPException(404, detail={"source": "Data", "error": "Indicateur non disponible pour ces pays"})
    return {"data": {"key": key, "label": i[1], "unit": i[3], "freq": i[7], "series": out}, "source": envs[0]["source"],
            "fetched_at": min(e["fetched_at"] for e in envs), "stale": any(e["stale"] for e in envs), "error": next((e["error"] for e in envs if e["error"]), None)}
