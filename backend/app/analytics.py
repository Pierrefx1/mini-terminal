"""Calculs de marché purs (sans accès réseau), testés dans tests/test_analytics.py."""
import math
import statistics
from datetime import datetime, timedelta, timezone

TRADING_DAYS = 252


def _pct(a: float | None, b: float | None) -> float | None:
    return (a / b - 1) * 100 if a is not None and b else None


def perf_stats(candles: list[dict], price: float | None = None, gmtoffset: int = 0) -> dict:
    """Statistiques d'un instrument à partir de bougies quotidiennes (ordre chronologique).

    Les variations sont en %, mesurées en séances : 1S = 5 séances, 1M = 21 séances.
    `price` (dernier cours connu) remplace la dernière clôture s'il est fourni.
    La volatilité réalisée est l'écart-type des rendements log des 20 dernières séances, annualisé (252).
    """
    if not candles:
        return {}
    closes = [c["close"] for c in candles]
    last = price if price is not None else closes[-1]
    back = lambda n: closes[-1 - n] if len(closes) > n else None  # noqa: E731

    # YTD : dernière clôture de l'année civile précédente, à l'heure de la place
    local_year = lambda t: (datetime.fromtimestamp(t, timezone.utc) + timedelta(seconds=gmtoffset)).year  # noqa: E731
    year = local_year(candles[-1]["time"])
    prev_year = [c["close"] for c in candles if local_year(c["time"]) < year]

    year_window = candles[-TRADING_DAYS:]
    rets = [math.log(b / a) for a, b in zip(closes[-21:-1], closes[-20:]) if a and b]
    vol = None
    if len(rets) >= 2:
        mean = sum(rets) / len(rets)
        vol = math.sqrt(sum((r - mean) ** 2 for r in rets) / (len(rets) - 1)) * math.sqrt(TRADING_DAYS) * 100
    vols = [c["volume"] for c in candles[-20:] if c.get("volume")]
    hi = max(c["high"] for c in year_window)
    lo = min(c["low"] for c in year_window)
    return {
        "last": last, "prev_close": back(1),
        "d1": _pct(last, back(1)), "w1": _pct(last, back(5)), "m1": _pct(last, back(21)),
        "ytd": _pct(last, prev_year[-1]) if prev_year else None,
        "hi52": hi, "lo52": lo,
        "from_hi52": _pct(last, hi),
        "range_pos": (last - lo) / (hi - lo) * 100 if hi > lo else None,  # 0 = plus bas, 100 = plus haut
        "vol20": vol,
        "volume": candles[-1].get("volume") or None,
        "avg_volume20": sum(vols) / len(vols) if vols else None,
    }


def breadth(changes: list[float | None]) -> dict:
    """Largeur de marché : nombre de hausses, baisses, inchangés et ratio hausses/baisses."""
    v = [c for c in changes if c is not None]
    up, down = sum(c > 0 for c in v), sum(c < 0 for c in v)
    return {"up": up, "down": down, "flat": len(v) - up - down, "total": len(v),
            "ad_ratio": up / down if down else None,
            "median": statistics.median(v) if v else None}
