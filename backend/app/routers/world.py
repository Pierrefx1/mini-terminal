"""WORLD MONITOR (commande WM) : globe des risques, publications et places financières.

/api/world/monitor : marqueurs (actualités géolocalisées, calendrier, places et mouvements de marché), bandeau de marchés, fil d'actualités.
/api/world/links   : arcs entre places (corrélation des indices sur 60 séances) et corridors énergétiques / commerciaux de référence.
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter

from .. import db
from .. import world as w
from ..cache import DELAYED, HISTORICAL, cached
from ..providers import rss
from ..providers.registry import prices

router = APIRouter(prefix="/api/world", tags=["world"])

# Flux d'actualité internationale (titres et liens vers l'éditeur uniquement)
WORLD_FEEDS = [
    ("BBC World", "https://feeds.bbci.co.uk/news/world/rss.xml", "UK", "en"),
    ("Guardian World", "https://www.theguardian.com/world/rss", "UK", "en"),
    ("Al Jazeera", "https://www.aljazeera.com/xml/rss/all.xml", "QA", "en"),
    ("DW World", "https://rss.dw.com/rdf/rss-en-world", "DE", "en"),
    ("France 24", "https://www.france24.com/en/rss", "FR", "en"),
    ("Le Monde International", "https://www.lemonde.fr/international/rss_full.xml", "FR", "fr"),
]
ECON_THEMES = ("Macro", "Banques centrales", "Inflation", "Emploi", "Commerce", "Énergie")
BAR = [("^GSPC", "S&P 500"), ("^IXIC", "Nasdaq"), ("^STOXX50E", "Euro Stoxx 50"), ("^FTSE", "FTSE 100"), ("^GDAXI", "DAX"), ("^N225", "Nikkei"),
       ("^HSI", "Hang Seng"), ("^VIX", "VIX"), ("^TNX", "US 10A"), ("DX-Y.NYB", "DXY"), ("EURUSD=X", "EUR/USD"), ("USDJPY=X", "USD/JPY"),
       ("BZ=F", "Brent"), ("NG=F", "Gaz US"), ("GC=F", "Or"), ("HG=F", "Cuivre"), ("BTC-USD", "Bitcoin")]
BIG_MOVE = 2.0  # variation d'indice (%) signalée comme événement


def _world_news() -> tuple[list[dict], list[str], list[str]]:
    items, failed, times = [], [], []
    for name, url, country, lang in WORLD_FEEDS:
        try:
            e = cached(f"rss:world:{name}", 300, name, lambda u=url, n=name, c=country, l=lang: rss.parse(n, u, c, l, "International"))
            items += e["data"]
            times.append(e["fetched_at"])
            if e["stale"]:
                failed.append(name)
        except Exception:
            failed.append(name)
    return items, failed, times


def _econ_news(hours: int = 48) -> list[dict]:
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat(timespec="seconds")
    q = f"SELECT id,title,link,source,published,summary,theme FROM news WHERE symbol='' AND published >= ? AND theme IN ({','.join('?' * len(ECON_THEMES))}) ORDER BY published DESC LIMIT 400"
    with db.conn() as c:
        return [dict(r) for r in c.execute(q, (since, *ECON_THEMES))]


def _quotes() -> dict:
    syms = list(dict.fromkeys([s for s, _ in BAR] + [c[6] for c in w.CENTERS]))
    return cached("world:quotes", 120, prices.name, lambda: prices.quotes(syms), status=DELAYED)


def _marker(id_, cat, kind, title, place: w.Place | tuple, **kw) -> dict:
    if isinstance(place, w.Place):
        geo = {"iso": place.iso, "country": place.country, "place": place.label, "lat": place.lat, "lon": place.lon}
    else:
        iso, label, lat, lon = place
        geo = {"iso": iso, "country": w.COUNTRIES.get(iso, (label,))[0], "place": label, "lat": lat, "lon": lon}
    return {"id": id_, "cat": cat, "kind": kind, "title": title, "critical": False, **geo, **kw}


@router.get("/monitor")
def monitor():
    now = datetime.now(timezone.utc)
    markers, news = [], []

    # 1. Actualités internationales et économiques géolocalisées
    world_items, failed, times = _world_news()
    seen = set()
    for it in sorted(world_items, key=lambda x: x["published"], reverse=True) + [dict(x, econ=True) for x in _econ_news()]:
        if it["id"] in seen:
            continue
        seen.add(it["id"])
        place = w.geolocate(it["title"], it.get("summary", ""))
        cls = ("econ", False) if it.get("econ") else w.classify(it["title"], it.get("summary", ""))
        row = {"id": it["id"], "title": it["title"], "summary": it.get("summary", ""), "link": it["link"], "source": it["source"],
               "time": it["published"], "cat": cls[0] if cls else None, "critical": bool(cls and cls[1]),
               "iso": place.iso if place else None, "country": place.country if place else None,
               "place": place.label if place else None, "lat": place.lat if place else None, "lon": place.lon if place else None}
        if not it.get("econ"):
            news.append(row)
        if place and cls and (now - datetime.fromisoformat(it["published"])).total_seconds() <= 72 * 3600:
            markers.append({**row, "kind": "news"})

    # 2. Calendrier : publications des 12 dernières heures et des 3 prochains jours
    with db.conn() as c:
        cal = [dict(r) for r in c.execute("SELECT id,title,country,time,impact,forecast,previous FROM calendar_events WHERE time BETWEEN ? AND ? ORDER BY time",
                                          ((now - timedelta(hours=12)).isoformat(), (now + timedelta(days=3)).isoformat()))]
    for e in cal:
        loc = w.CURRENCY_PLACE.get(e["country"])
        if not loc or e["impact"] not in ("High", "Medium"):
            continue
        cat = "event" if e["impact"] == "High" else "econ"
        markers.append(_marker(f"cal:{e['id']}", cat, "calendar", f"{e['country']} · {e['title']}", loc, time=e["time"], impact=e["impact"],
                               forecast=e["forecast"], previous=e["previous"], source="Calendrier ForexFactory",
                               summary=f"Publication {'à fort impact' if e['impact'] == 'High' else 'à impact moyen'}"
                                       + (f" · consensus {e['forecast']}" if e["forecast"] else "") + (f" · précédent {e['previous']}" if e["previous"] else "")))

    # 3. Places financières (blanc) et mouvements de marché (orange)
    qenv = _quotes()
    q = {x["symbol"]: x for x in qenv["data"]}
    centers = []
    for code, city, iso, lat, lon, exch, sym, label in w.CENTERS:
        x = q.get(sym, {})
        centers.append({"code": code, "city": city, "iso": iso, "lat": lat, "lon": lon, "exchange": exch, "symbol": sym, "index": label,
                        "price": x.get("price"), "change_pct": x.get("change_pct"), "time": x.get("time")})
        markers.append(_marker(f"ctr:{code}", "center", "center", f"{city} · {exch}", (iso, city, lat, lon), symbol=sym, index=label,
                               price=x.get("price"), change_pct=x.get("change_pct"), time=x.get("time"), source="Yahoo Finance (différé)"))
        if x.get("change_pct") is not None and abs(x["change_pct"]) >= BIG_MOVE:
            markers.append(_marker(f"mv:{code}", "event", "market", f"{label} {x['change_pct']:+.2f} %", (iso, city, lat, lon), symbol=sym,
                                   change_pct=x["change_pct"], price=x.get("price"), time=x.get("time"), source="Yahoo Finance (différé)",
                                   summary=f"Variation de l'indice phare de {city} supérieure à {BIG_MOVE:g} % en valeur absolue."))
    bar = [{"symbol": s, "label": lab, **{k: q.get(s, {}).get(k) for k in ("price", "change", "change_pct", "time")}} for s, lab in BAR]

    sources = f"RSS international ({len(WORLD_FEEDS) - len(failed)}/{len(WORLD_FEEDS)}) · ForexFactory · {prices.name}"
    return {"data": {"markers": markers, "news": news[:150], "markets": bar, "centers": centers, "generated_at": now.isoformat(timespec="seconds")},
            "source": sources, "status": DELAYED, "fetched_at": min(times + [qenv["fetched_at"]]) if times else qenv["fetched_at"],
            "stale": bool(failed) or qenv["stale"], "error": ("Flux en échec : " + ", ".join(failed)) if failed else qenv["error"]}


@router.get("/links")
def links():
    def fetch():
        syms = [c[6] for c in w.CENTERS]
        series: dict[str, list] = {}
        for i in range(0, len(syms), 20):
            for s, v in prices.spark(syms[i:i + 20], "6mo", "1d").items():
                series[s] = [(datetime.fromtimestamp(t, timezone.utc).date().isoformat(), c) for t, c in zip(v["t"], v["c"])]
        by_sym = {c[6]: c for c in w.CENTERS}
        corr = sorted(w.correlations(series), key=lambda x: -x[2])
        out = []
        for a, b, r, n in corr:
            if r < 0.55:
                break
            ca, cb = by_sym[a], by_sym[b]
            out.append({"cat": "finance", "label": f"{ca[7]} ↔ {cb[7]}", "corr": round(r, 3), "n": n, "weight": r,
                        "from": {"lat": ca[3], "lon": ca[4], "name": ca[1]}, "to": {"lat": cb[3], "lon": cb[4], "name": cb[1]}})
        return out[:24]

    fin = cached("world:links:finance", 3600, prices.name, fetch, status=HISTORICAL)
    ref = lambda cat, routes: [{"cat": cat, "label": lab, "weight": 0.6, "from": {"lat": a[0], "lon": a[1]}, "to": {"lat": b[0], "lon": b[1]}} for lab, a, b in routes]
    return {**fin, "data": {"arcs": fin["data"] + ref("energy", w.ENERGY_ROUTES) + ref("trade", w.TRADE_ROUTES),
                            "notes": {"finance": "Corrélation des rendements journaliers des indices phares sur les 60 dernières séances communes (≥ 0,55). "
                                                 "Les places asiatiques clôturent avant l'ouverture américaine : leur corrélation avec les États-Unis est sous-estimée.",
                                      "energy": "Grands corridors pétroliers et gaziers (référence structurelle : EIA, World Oil Transit Chokepoints ; IEA). Pas de volume mesuré en temps réel.",
                                      "trade": "Principaux corridors commerciaux (référence structurelle : OMC, premiers partenaires commerciaux). Pas de volume mesuré en temps réel."}}}
