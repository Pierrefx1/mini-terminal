"""CFTC Commitments of Traders (rapport « legacy », futures seuls) : positions hebdomadaires, domaine public."""
from ..cache import SourceError
from .http import get

URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"


class CFTC:
    name = "CFTC COT (hebdomadaire)"

    def history(self, code: str, weeks: int = 260) -> list[dict]:
        rows = get(URL, params={"$limit": weeks, "$order": "report_date_as_yyyy_mm_dd DESC", "$where": f"cftc_contract_market_code='{code}'"}).json()
        if not rows:
            raise SourceError(f"CFTC : aucun rapport pour le marché {code}")
        n = lambda r, k: float(r.get(k) or 0)  # noqa: E731
        out = [{"date": r["report_date_as_yyyy_mm_dd"][:10], "market": r["market_and_exchange_names"],
                "oi": n(r, "open_interest_all"),
                "spec_long": n(r, "noncomm_positions_long_all"), "spec_short": n(r, "noncomm_positions_short_all"),
                "comm_long": n(r, "comm_positions_long_all"), "comm_short": n(r, "comm_positions_short_all"),
                "small_long": n(r, "nonrept_positions_long_all"), "small_short": n(r, "nonrept_positions_short_all")} for r in rows]
        return sorted(out, key=lambda x: x["date"])
