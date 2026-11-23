"""SEC EDGAR : correspondance ticker → CIK et « company facts » XBRL (gratuit, sans clé, limite 10 requêtes/s)."""
import httpx

from ..cache import SourceError
from ..config import SEC_USER_AGENT

client = httpx.Client(timeout=30, follow_redirects=True, headers={"User-Agent": SEC_USER_AGENT or "market-terminal", "Accept-Encoding": "gzip, deflate"})
TICKERS = "https://www.sec.gov/files/company_tickers.json"
FACTS = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"


def _get(url: str) -> dict:
    if not SEC_USER_AGENT:
        raise SourceError("SEC : renseigner SEC_USER_AGENT dans .env (« Nom email@domaine »), contact exigé par la SEC")
    try:
        r = client.get(url)
    except httpx.TransportError as e:
        raise SourceError(f"SEC injoignable : {e}") from e
    if r.status_code == 404:
        raise SourceError("SEC : aucune donnée XBRL pour cette société")
    if r.status_code in (403, 429):
        raise SourceError("SEC : accès refusé ou limite atteinte (renseigner SEC_USER_AGENT dans .env)")
    r.raise_for_status()
    return r.json()


def ticker_map() -> dict[str, int]:
    return {v["ticker"].upper(): int(v["cik_str"]) for v in _get(TICKERS).values()}


def company_facts(cik: int) -> dict:
    return _get(FACTS.format(cik=cik))
