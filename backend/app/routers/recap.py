"""Récap marché du matin rédigé par Google Gemini à partir des données déjà collectées par le terminal.

Généré une fois par jour (planificateur, 7 h 30 heure de Paris) ou à la demande. Le récap
est stocké dans le cache : si la génération échoue, le dernier récap reste affiché.
"""
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .. import config, db, gemini
from ..cache import SourceError, cached
from . import calendar, forecasts, macro, market, news, screener

router = APIRouter(prefix="/api/recap", tags=["récap"])
log = logging.getLogger("mini-terminal")
KEY = "recap:daily"
SOURCE = f"Gemini ({config.RECAP_MODEL})"
PARIS = ZoneInfo("Europe/Paris")
HOUR, MINUTE = 7, 30  # heure de rédaction du récap (Paris)
NO_KEY = "Récap IA désactivé : renseigner GEMINI_API_KEY dans .env puis relancer."


class Section(BaseModel):
    title: str = Field(description="Titre court : « Marchés », « Taux et banques centrales », « Actualité », etc.")
    points: list[str] = Field(description="2 à 4 phrases courtes et factuelles, chiffres à l'appui")


class Recap(BaseModel):
    headline: str = Field(description="Une phrase qui résume la tonalité du marché ce matin")
    mood: Literal["risk-on", "neutre", "risk-off"]
    sections: list[Section]
    watch: list[str] = Field(description="2 à 5 points à surveiller aujourd'hui (publications, événements), avec l'heure de Paris quand elle est connue")


SYSTEM = """Tu es l'analyste d'un terminal financier personnel. Chaque matin tu rédiges, en français, un récap très court de l'état du marché pour un investisseur particulier averti.

Règles :
- Appuie-toi uniquement sur les données fournies. N'invente aucun chiffre, aucun événement. Si une donnée manque, n'en parle pas.
- Cite les chiffres utiles (niveaux, variations en %, taux, écarts en pb) plutôt que des adjectifs.
- Explique le « pourquoi » quand les news le permettent, sinon reste descriptif.
- Style télégraphique et sobre, pas de conseil d'investissement, pas de formule creuse.
- 3 ou 4 sections : marchés (actions, devises, matières, crypto), taux et banques centrales, actualité macro/géopolitique, et éventuellement une section actions S&P 500 si les mouvements sont notables.
- Le tout doit se lire en moins d'une minute."""


def _try(label: str, fn):
    try:
        return fn()
    except Exception as e:  # une source en panne ne bloque pas le récap
        log.warning("récap : %s indisponible (%s)", label, e)
        return None


def _context() -> dict:
    now = datetime.now(timezone.utc)
    ctx: dict = {"maintenant_paris": now.astimezone(PARIS).strftime("%A %Y-%m-%d %H:%M")}

    q = _try("cours", lambda: market.ticker()["data"])
    if q:
        ctx["cours"] = [{k: x.get(k) for k in ("symbol", "name", "price", "change_pct")} for x in q if not x.get("error")]

    y = _try("taux", lambda: macro.yields(1)["data"]["nominal"][-2:])
    if y:
        ctx["taux_us_veille_et_dernier"] = [{k: r.get(k) for k in ("date", "3M", "2A", "10A", "30A")} for r in y]

    pol = _try("taux directeurs", lambda: macro.policy_rates()["data"]["banks"][:6])
    if pol:
        ctx["taux_directeurs"] = pol

    ffr = _try("Fed anticipée", lambda: forecasts.rates()["data"])
    if ffr and ffr.get("path"):
        ctx["fed_funds_anticipes"] = {"actuel": (ffr.get("current") or {}).get("rate"), "trajectoire": ffr["path"][:6]}

    rows = _try("screener", lambda: screener.screener("sp500")["data"]["rows"])
    if rows:
        r = sorted((x for x in rows if x.get("d1") is not None), key=lambda x: x["d1"])
        if r:
            ctx["sp500_seance"] = {"hausse": sum(x["d1"] > 0 for x in r), "baisse": sum(x["d1"] < 0 for x in r),
                                   "plus_fortes_hausses": [(x["symbol"], x["name"], round(x["d1"], 2)) for x in r[-5:][::-1]],
                                   "plus_fortes_baisses": [(x["symbol"], x["name"], round(x["d1"], 2)) for x in r[:5]]}

    cal = _try("calendrier", lambda: calendar.calendar()["data"]["events"])
    if cal:
        iso = now.isoformat()
        hi = [e for e in cal if e["impact"] in ("High", "Medium")]
        ctx["publications_recentes"] = [{k: e[k] for k in ("title", "country", "time", "forecast", "actual")} for e in hi if e["time"] <= iso][-12:]
        ctx["publications_a_venir"] = [{k: e[k] for k in ("title", "country", "time", "impact", "forecast", "previous")} for e in hi if e["time"] > iso][:12]

    _try("news", news.refresh)
    with db.conn() as c:
        items = [dict(r) for r in c.execute(
            "SELECT title, summary, source, published FROM news WHERE symbol='' AND published > datetime('now','-1 day') ORDER BY published DESC LIMIT 120")]
    ctx["news_24h"] = [{"t": i["title"], "s": i["summary"][:240], "src": i["source"], "at": i["published"]} for i in items]
    return ctx


def _generate() -> dict:
    if not config.GEMINI_API_KEY:
        raise SourceError(NO_KEY)
    ctx = _context()
    if not ctx.get("cours") and not ctx.get("news_24h"):
        raise SourceError("Aucune donnée de marché ni news disponible pour rédiger le récap.")
    resp, model = gemini.generate(
        "Données du terminal (JSON) :\n" + json.dumps(ctx, ensure_ascii=False, default=str)
        + "\n\nRédige le récap marché de ce matin.",
        system_instruction=SYSTEM, response_mime_type="application/json", response_schema=Recap)
    out = resp.parsed
    if not isinstance(out, Recap):
        reason = resp.candidates[0].finish_reason if resp.candidates else getattr(resp.prompt_feedback, "block_reason", None)
        raise SourceError(f"Récap non généré (arrêt : {reason}).")
    return {**out.model_dump(), "model": model, "news_count": len(ctx["news_24h"])}


def _age_limit() -> float:
    """Secondes écoulées depuis le dernier 7 h 30 (Paris) : un récap plus ancien est à refaire."""
    now = datetime.now(PARIS)
    edge = now.replace(hour=HOUR, minute=MINUTE, second=0, microsecond=0)
    if now < edge:
        edge -= timedelta(days=1)
    return (now - edge).total_seconds()


def refresh() -> dict:
    """Tâche planifiée du matin."""
    return cached(KEY, 0, SOURCE, _generate, force=True)


@router.get("")
def recap():
    # Si le terminal était éteint à 7 h 30, le récap du jour est rédigé à la première ouverture.
    return cached(KEY, _age_limit(), SOURCE, _generate)


@router.post("/refresh")
def force_refresh():
    return refresh()
