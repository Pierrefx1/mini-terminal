from fastapi import APIRouter, HTTPException

from ..cache import cached
from ..providers.coingecko import CoinGecko, fear_greed

router = APIRouter(prefix="/api/crypto", tags=["crypto"])
cg = CoinGecko()


@router.get("")
def crypto(currency: str = "usd"):
    if currency not in ("usd", "eur"):
        raise HTTPException(400, "Devise : usd ou eur")
    coins = cached(f"cg:markets:{currency}", 180, cg.name, lambda: cg.markets(currency))
    extras, errors = {}, []
    for key, ttl, source, fn in (("global", 300, cg.name, cg.global_), ("stable", 86400, cg.name, cg.stablecoin_ids),
                                 ("fng", 3600, "alternative.me", fear_greed)):
        try:  # un bloc secondaire en panne ne masque pas le tableau principal
            e = cached(f"cg:{key}", ttl, source, fn)
            extras[key] = e["data"]
            if e["stale"]:
                errors.append(f"{source} : {e['error']}")
        except HTTPException as ex:
            extras[key] = None
            errors.append(f"{source} : {ex.detail.get('error') if isinstance(ex.detail, dict) else ex.detail}")
    stable = set(extras["stable"] or [])
    rows = [{**c, "stable": c["id"] in stable} for c in coins["data"]]
    g = extras["global"]
    glob = g and {"market_cap": g["market_cap"].get(currency), "volume": g["volume"].get(currency), "change_24h": g["change_24h"],
                  "btc": g["dominance"].get("btc"), "eth": g["dominance"].get("eth"),
                  "stable": sum(v for k, v in g["dominance"].items() if k in ("usdt", "usdc", "dai", "usde", "usds")), "coins": g["coins"]}
    err = " ; ".join(filter(None, [coins["error"], *errors]))
    return {"data": {"currency": currency, "coins": rows, "global": glob, "fear_greed": extras["fng"], "stable_known": extras["stable"] is not None},
            "source": "CoinGecko + alternative.me", "fetched_at": coins["fetched_at"], "stale": coins["stale"] or bool(errors), "error": err or None}
