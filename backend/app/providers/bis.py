"""BRI : taux directeurs des banques centrales (sans clé)."""
import csv
import io

from ..cache import SourceError
from .http import get

AREAS = {"US": "Fed", "XM": "BCE", "GB": "BoE", "JP": "BoJ", "CH": "BNS", "CA": "BdC", "AU": "RBA", "CN": "PBoC"}


class BIS:
    name = "BRI (taux directeurs)"

    def policy_rates(self, start: str = "2000-01-01", all_areas: bool = False) -> dict:
        """Taux directeurs en escalier. all_areas : toutes les banques centrales suivies par la BRI (≈ 40), libellées par leur zone."""
        url = f"https://stats.bis.org/api/v2/data/dataflow/BIS/WS_CBPOL/1.0/D.{'' if all_areas else '+'.join(AREAS)}"
        text = get(url, params={"startPeriod": start}, headers={"Accept": "application/vnd.sdmx.data+csv"}, timeout=60).text
        series: dict[str, list] = {a: [] for a in AREAS}
        for r in csv.DictReader(io.StringIO(text)):
            a, v = r.get("REF_AREA"), r.get("OBS_VALUE")
            if all_areas and a and a not in series:
                series[a] = []
            if a in series and v not in ("", "NaN", None):
                series[a].append([r["TIME_PERIOD"], float(v)])
        if not any(series.values()):
            raise SourceError("BRI : aucune observation reçue")
        out = []
        for a, obs in series.items():
            if not obs:
                continue
            obs.sort()
            # ne garder que les changements de taux + le dernier point (série en escalier)
            steps = [o for i, o in enumerate(obs) if i == 0 or o[1] != obs[i - 1][1]]
            if steps[-1][0] != obs[-1][0]:
                steps.append(obs[-1])
            out.append({"area": a, "bank": AREAS.get(a, a), "rate": obs[-1][1], "date": obs[-1][0],
                        "last_change": steps[-2][0] if len(steps) >= 2 and steps[-1][1] == steps[-2][1] else steps[-1][0],
                        "previous": next((s[1] for s in reversed(steps) if s[1] != obs[-1][1]), None), "steps": steps})
        return {"banks": out}
