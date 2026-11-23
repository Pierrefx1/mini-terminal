"""CFTC Commitments of Traders, domaine public.

- Rapport « legacy » (futures seuls) : non commerciaux, commerciaux, non déclarés.
- Rapport « Traders in Financial Futures » (TFF, futures seuls) : courtiers (dealers), gérants d'actifs,
  fonds à effet de levier, autres déclarés, non déclarés. C'est la référence pour les devises.
"""
from ..cache import SourceError
from .http import get

URL = "https://publicreporting.cftc.gov/resource/6dca-aqww.json"
TFF_URL = "https://publicreporting.cftc.gov/resource/gpe5-46if.json"


def _n(r: dict, k: str) -> float:
    return float(r.get(k) or 0)


class CFTC:
    name = "CFTC COT (hebdomadaire)"

    def history(self, code: str, weeks: int = 260) -> list[dict]:
        rows = get(URL, params={"$limit": weeks, "$order": "report_date_as_yyyy_mm_dd DESC", "$where": f"cftc_contract_market_code='{code}'"}).json()
        if not rows:
            raise SourceError(f"CFTC : aucun rapport pour le marché {code}")
        out = [{"date": r["report_date_as_yyyy_mm_dd"][:10], "market": r["market_and_exchange_names"],
                "oi": _n(r, "open_interest_all"),
                "spec_long": _n(r, "noncomm_positions_long_all"), "spec_short": _n(r, "noncomm_positions_short_all"),
                "comm_long": _n(r, "comm_positions_long_all"), "comm_short": _n(r, "comm_positions_short_all"),
                "small_long": _n(r, "nonrept_positions_long_all"), "small_short": _n(r, "nonrept_positions_short_all")} for r in rows]
        return sorted(out, key=lambda x: x["date"])

    def _batch(self, url: str, codes: list[str], since: str, fields: dict[str, str]) -> dict[str, list[dict]]:
        where = f"cftc_contract_market_code in ({','.join(repr(c) for c in codes)}) AND report_date_as_yyyy_mm_dd >= '{since}T00:00:00.000'"
        rows = get(url, params={"$limit": 50000, "$order": "report_date_as_yyyy_mm_dd", "$where": where}, timeout=60).json()
        if not rows:
            raise SourceError("CFTC : aucun rapport reçu")
        out: dict[str, list[dict]] = {c: [] for c in codes}
        for r in rows:
            c = r["cftc_contract_market_code"].strip()
            if c in out:
                out[c].append({"date": r["report_date_as_yyyy_mm_dd"][:10], "market": r["market_and_exchange_names"],
                               **{k: _n(r, f) for k, f in fields.items()}})
        return out

    def tff(self, codes: list[str], since: str) -> dict[str, list[dict]]:
        """Rapport TFF de plusieurs marchés depuis `since` (AAAA-MM-JJ) : {code: [semaines triées]}."""
        return self._batch(TFF_URL, codes, since, {
            "oi": "open_interest_all", "oi_chg": "change_in_open_interest_all",
            "dealer_long": "dealer_positions_long_all", "dealer_short": "dealer_positions_short_all",
            "am_long": "asset_mgr_positions_long", "am_short": "asset_mgr_positions_short",
            "lev_long": "lev_money_positions_long", "lev_short": "lev_money_positions_short",
            "other_long": "other_rept_positions_long", "other_short": "other_rept_positions_short",
            "small_long": "nonrept_positions_long_all", "small_short": "nonrept_positions_short_all",
            "traders_lev_long": "traders_lev_money_long_all", "traders_lev_short": "traders_lev_money_short_all",
            "traders_am_long": "traders_asset_mgr_long_all", "traders_am_short": "traders_asset_mgr_short_all",
        })

    def legacy(self, codes: list[str], since: str) -> dict[str, list[dict]]:
        """Rapport legacy de plusieurs marchés depuis `since` : non commerciaux et commerciaux."""
        return self._batch(URL, codes, since, {
            "oi": "open_interest_all",
            "spec_long": "noncomm_positions_long_all", "spec_short": "noncomm_positions_short_all",
            "comm_long": "comm_positions_long_all", "comm_short": "comm_positions_short_all",
        })
