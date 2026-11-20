"""Appel unique à Google Gemini : délai maximal, modèles de repli et messages d'erreur lisibles.

Utilisé par le récap du matin et les notes de recherche.
"""
import logging

import httpx
from google import genai
from google.genai import errors, types

from . import config
from .cache import SourceError

log = logging.getLogger("mini-terminal")
RETRYABLE = {429, 500, 503, 504}  # saturation ou panne passagère : on tente le modèle suivant


def generate(contents: str, **cfg) -> tuple[types.GenerateContentResponse, str]:
    """Renvoie (réponse, modèle utilisé). Lève SourceError avec un message prêt à afficher."""
    if not config.GEMINI_API_KEY:
        raise SourceError("Clé Gemini absente : renseigner GEMINI_API_KEY dans .env puis relancer.")
    # Le client doit rester référencé pendant l'appel : sinon il est fermé avant d'envoyer la requête.
    client = genai.Client(api_key=config.GEMINI_API_KEY,
                          http_options=types.HttpOptions(timeout=int(config.GEMINI_TIMEOUT * 1000)))
    models = list(dict.fromkeys([config.RECAP_MODEL, *config.RECAP_FALLBACKS]))
    last = "erreur inconnue"
    for model in models:
        try:
            resp = client.models.generate_content(model=model, contents=contents,
                                                  config=types.GenerateContentConfig(**cfg))
            return resp, resp.model_version or model
        except errors.APIError as e:
            if e.code in (401, 403) or "API key" in str(e):
                raise SourceError("Clé Gemini invalide ou non autorisée : vérifier GEMINI_API_KEY dans .env.")
            if e.code not in RETRYABLE and e.code != 404:
                raise SourceError(f"API Gemini : erreur {e.code} ({e.message}).")
            last = {429: "quota atteint", 404: "modèle introuvable"}.get(e.code, f"saturé (erreur {e.code})")
        except httpx.TimeoutException:
            last = f"pas de réponse en {config.GEMINI_TIMEOUT:.0f} s"
        except (httpx.TransportError, OSError) as e:
            raise SourceError(f"API Gemini injoignable ({e}).")
        log.warning("Gemini %s : %s, modèle suivant", model, last)
    raise SourceError(f"Gemini indisponible pour le moment ({last} sur {', '.join(models)}). Réessayer plus tard.")
