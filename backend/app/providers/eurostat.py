"""Eurostat : séries mensuelles et trimestrielles des pays européens (sans clé)."""
from ..cache import SourceError
from .http import get

BASE = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data"


class Eurostat:
    name = "Eurostat"

    def fetch(self, dataset: str, filters: dict, geos: list[str], since: str = "2005") -> dict:
        """{geo: [[période, valeur], ...]} ; période au format Eurostat (2026-10, 2026-Q3)."""
        params = [(k, v) for k, v in filters.items()] + [("geo", g) for g in geos] + [("sinceTimePeriod", since), ("format", "JSON")]
        r = get(f"{BASE}/{dataset}", params=params, timeout=60)
        try:
            d = r.json()
        except ValueError:  # page d'indisponibilité HTML (redirection vers sorry.ec.europa.eu)
            raise RuntimeError(f"Eurostat indisponible (réponse non JSON depuis {r.url.host})") from None
        if "error" in d or "value" not in d:
            raise SourceError(f"Eurostat {dataset} : {str(d.get('error', d))[:160]}")
        ids, sizes = d["id"], d["size"]
        if any(s > 1 for i, s in zip(ids, sizes) if i not in ("geo", "time")):
            raise SourceError(f"Eurostat {dataset} : filtres insuffisants, plusieurs séries renvoyées")
        gi, ti = d["dimension"]["geo"]["category"]["index"], d["dimension"]["time"]["category"]["index"]
        gpos, tpos = ids.index("geo"), ids.index("time")
        stride = lambda pos: __import__("math").prod(sizes[pos + 1:])
        out = {}
        for g, gidx in gi.items():
            obs = []
            for t, tidx in ti.items():
                v = d["value"].get(str(gidx * stride(gpos) + tidx * stride(tpos)))
                if v is not None:
                    obs.append([t, v])
            if obs:
                out[g] = sorted(obs)
        return out
