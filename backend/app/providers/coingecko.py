"""CoinGecko (API publique sans clé) : marché crypto. Quota gratuit limité, d'où un cache de quelques minutes."""
from ..cache import SourceError
from .http import get

API = "https://api.coingecko.com/api/v3"
KEEP = ("id", "symbol", "name", "current_price", "market_cap", "market_cap_rank", "fully_diluted_valuation", "total_volume", "high_24h", "low_24h",
        "circulating_supply", "max_supply", "ath", "ath_change_percentage", "ath_date", "last_updated")


class CoinGecko:
    name = "CoinGecko"

    def markets(self, currency: str = "usd", n: int = 250) -> list[dict]:
        rows = get(f"{API}/coins/markets", params={"vs_currency": currency, "order": "market_cap_desc", "per_page": n, "page": 1,
                                                    "sparkline": "true", "price_change_percentage": "1h,24h,7d,30d,1y"}, timeout=40).json()
        if not isinstance(rows, list) or not rows:
            raise SourceError(f"CoinGecko : réponse inattendue ({str(rows)[:120]})")
        out = []
        for r in rows:
            spark = (r.get("sparkline_in_7d") or {}).get("price") or []
            out.append({**{k: r.get(k) for k in KEEP},
                        "h1": r.get("price_change_percentage_1h_in_currency"), "h24": r.get("price_change_percentage_24h_in_currency"),
                        "d7": r.get("price_change_percentage_7d_in_currency"), "d30": r.get("price_change_percentage_30d_in_currency"),
                        "y1": r.get("price_change_percentage_1y_in_currency"), "spark": spark[::4]})
        return out

    def stablecoin_ids(self) -> list[str]:
        rows = get(f"{API}/coins/markets", params={"vs_currency": "usd", "category": "stablecoins", "per_page": 250, "page": 1}, timeout=40).json()
        if not isinstance(rows, list):
            raise SourceError("CoinGecko : liste des stablecoins indisponible")
        return [r["id"] for r in rows]

    def global_(self) -> dict:
        d = get(f"{API}/global").json()["data"]
        return {"market_cap": d["total_market_cap"], "volume": d["total_volume"], "change_24h": d["market_cap_change_percentage_24h_usd"],
                "dominance": d["market_cap_percentage"], "coins": d["active_cryptocurrencies"], "updated_at": d["updated_at"]}


def fear_greed() -> list[dict]:
    """Indice « Fear & Greed » d'alternative.me : 0 = peur extrême, 100 = avidité extrême."""
    d = get("https://api.alternative.me/fng/", params={"limit": 31}).json()["data"]
    return [{"value": int(x["value"]), "label": x["value_classification"], "time": int(x["timestamp"])} for x in d]
