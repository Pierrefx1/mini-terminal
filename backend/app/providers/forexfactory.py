"""Calendrier économique : export hebdomadaire publié par ForexFactory.

Limites : semaine en cours uniquement ; consensus et précédent fournis, pas le chiffre réel.
"""
import hashlib
from datetime import datetime, timezone

from ..cache import SourceError
from .http import get

URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"


class ForexFactory:
    name = "ForexFactory (export hebdo)"

    def events(self) -> list[dict]:
        rows = get(URL).json()
        if not isinstance(rows, list):
            raise SourceError("ForexFactory : réponse inattendue")
        out = []
        for r in rows:
            t = datetime.fromisoformat(r["date"]).astimezone(timezone.utc).isoformat(timespec="minutes")
            eid = hashlib.sha1(f"{r['title']}|{r['country']}|{t[:10]}".encode()).hexdigest()[:16]
            out.append({"id": eid, "title": r["title"], "country": r["country"], "time": t, "impact": r.get("impact") or "Low",
                        "forecast": r.get("forecast") or "", "previous": r.get("previous") or ""})
        return out
