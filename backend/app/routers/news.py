import re
from concurrent.futures import ThreadPoolExecutor

import httpx
from fastapi import APIRouter, HTTPException, Response

from .. import db
from ..cache import LIVE, cached
from ..providers import rss

router = APIRouter(prefix="/api/news", tags=["news"])
COLS = "id,title,link,source,published,summary,theme,country,lang,symbol,image"


def _store(items: list[dict]) -> None:
    with db.conn() as c:
        # un article déjà connu récupère son illustration et son résumé long s'ils manquaient (bases antérieures)
        c.executemany(f"INSERT INTO news({COLS}) VALUES (:id,:title,:link,:source,:published,:summary,:theme,:country,:lang,:symbol,:image) "
                      "ON CONFLICT(id) DO UPDATE SET image = CASE WHEN news.image = '' THEN excluded.image ELSE news.image END, "
                      "summary = CASE WHEN length(excluded.summary) > length(news.summary) THEN excluded.summary ELSE news.summary END",
                      [{"image": "", **i} for i in items])
        c.execute("DELETE FROM news WHERE published < datetime('now','-45 days')")


def refresh() -> dict:
    """Rafraîchit chaque flux séparément : un flux en panne ne bloque pas les autres."""
    failed, times = [], []
    for name, url, country, lang, theme in rss.FEEDS:
        try:
            e = cached(f"rss2:{name}", 300, name, lambda: rss.parse(name, url, country, lang, theme))
            _store(e["data"])
            times.append(e["fetched_at"])
            if e["stale"]:
                failed.append(f"{name} ({e['error']})")
        except Exception as ex:
            failed.append(f"{name} ({getattr(ex, 'detail', {}).get('error', ex) if hasattr(ex, 'detail') else ex})")
    return {"failed": failed, "fetched_at": min(times) if times else None, "feeds": len(rss.FEEDS)}


@router.get("")
def news(theme: str = "", country: str = "", q: str = "", symbol: str = "", limit: int = 300):
    if symbol:
        e = cached(f"rss2:sym:{symbol.upper()}", 300, "Yahoo Finance (RSS)", lambda: rss.symbol_feed(symbol))
        _store(e["data"])
        meta = {"source": e["source"], "fetched_at": e["fetched_at"], "stale": e["stale"], "error": e["error"]}
    else:
        r = refresh()
        meta = {"source": f"RSS ({r['feeds'] - len(r['failed'])}/{r['feeds']} flux)", "fetched_at": r["fetched_at"], "stale": bool(r["failed"]),
                "error": ("Flux en échec : " + " ; ".join(r["failed"])) if r["failed"] else None}
    where, args = ["symbol = ?"], [symbol.upper()]
    if theme:
        where.append("theme = ?"); args.append(theme)
    if country:
        where.append("country = ?"); args.append(country)
    if q:
        where.append("(title LIKE ? OR summary LIKE ?)"); args += [f"%{q}%", f"%{q}%"]
    with db.conn() as c:
        rows = [dict(x) for x in c.execute(f"SELECT {COLS} FROM news WHERE {' AND '.join(where)} ORDER BY published DESC LIMIT ?", (*args, limit))]
        themes = [x[0] for x in c.execute("SELECT theme FROM news WHERE symbol='' GROUP BY theme ORDER BY count(*) DESC")]
    return {"data": {"items": rows, "themes": themes}, **meta}


# ─────────────────────────── Illustrations (relais local) ───────────────────────────
_img_client = httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (compatible; market-terminal)"})


@router.get("/img")
def img(u: str):
    """Relaie l'illustration d'un article : le navigateur ne contacte pas les sites de presse.
    Seules les URL présentes dans la base d'articles sont servies (pas de proxy ouvert)."""
    with db.conn() as c:
        known = c.execute("SELECT 1 FROM news WHERE image = ? LIMIT 1", (u,)).fetchone()
    if not known or not u.startswith("https://"):
        raise HTTPException(404, "Image inconnue")
    try:
        r = _img_client.get(u)
        r.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(502, "Image indisponible")
    ctype = r.headers.get("content-type", "")
    if not ctype.startswith("image/") or len(r.content) > 5_000_000:
        raise HTTPException(502, "Contenu non image")
    return Response(r.content, media_type=ctype, headers={"Cache-Control": "public, max-age=86400, immutable"})


# ─────────────────────────── Vidéo en direct (chaînes d'information sur YouTube) ───────────────────────────
# (clé, libellé, identifiant @ de la chaîne, langue, description). L'identifiant de la vidéo en direct change à chaque diffusion :
# il est résolu depuis la page /live de la chaîne, puis intégré via youtube.com/embed.
CHANNELS = [
    ("yahoo", "Yahoo Finance", "YahooFinance", "en", "Marchés américains en continu"),
    ("bloomberg", "Bloomberg Television", "BloombergTelevision", "en", "Marchés mondiaux (direct ponctuel sur YouTube)"),
    ("f24fr", "France 24", "FRANCE24", "fr", "Information internationale en français"),
    ("f24en", "France 24 English", "France24_en", "en", "Information internationale en anglais"),
    ("euronews", "Euronews", "euronews", "en", "Actualité européenne"),
    ("dw", "DW News", "dwnews", "en", "Actualité internationale (Allemagne)"),
    ("sky", "Sky News", "SkyNews", "en", "Actualité britannique et internationale"),
    ("bfm", "BFM Business", "BFMBusiness", "fr", "Économie française (direct ponctuel sur YouTube)"),
]
_yt = httpx.Client(timeout=15, follow_redirects=True, cookies={"CONSENT": "YES+cb", "SOCS": "CAI"},
                   headers={"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
                            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"})
CANON = re.compile(r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([A-Za-z0-9_-]{11})"')


def live_video(handle: str) -> str | None:
    """Identifiant de la vidéo en direct d'une chaîne, ou None si elle ne diffuse pas en ce moment."""
    try:
        page = _yt.get(f"https://www.youtube.com/@{handle}/live").text
    except httpx.HTTPError:
        return None
    m = CANON.search(page)
    return m.group(1) if m and '"isLive":true' in page else None


@router.get("/live")
def live():
    def fetch():
        with ThreadPoolExecutor(8) as ex:
            vids = list(ex.map(lambda c: live_video(c[2]), CHANNELS))
        out = [{"key": k, "label": l, "lang": lang, "desc": d, "video_id": v, "url": f"https://www.youtube.com/@{h}/live"}
               for (k, l, h, lang, d), v in zip(CHANNELS, vids)]
        if not any(o["video_id"] for o in out):
            raise RuntimeError("aucune chaîne en direct trouvée (YouTube injoignable ?)")
        return out
    return cached("news:live", 600, "YouTube (directs publics)", fetch, status=LIVE)
