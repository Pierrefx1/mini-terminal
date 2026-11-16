"""Flux RSS publics d'actualité économique et financière."""
import hashlib
import html
import re
import calendar
from datetime import datetime, timezone

import feedparser

from .http import get

# (nom, url, pays, langue, thème par défaut)
FEEDS = [
    ("CNBC Économie", "https://www.cnbc.com/id/20910258/device/rss/rss.html", "US", "en", "Macro"),
    ("CNBC Marchés", "https://www.cnbc.com/id/15839069/device/rss/rss.html", "US", "en", "Marchés"),
    ("CNBC À la une", "https://www.cnbc.com/id/100003114/device/rss/rss.html", "US", "en", "Marchés"),
    ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_topstories", "US", "en", "Marchés"),
    ("Fed", "https://www.federalreserve.gov/feeds/press_all.xml", "US", "en", "Banques centrales"),
    ("BEA", "https://apps.bea.gov/rss/rss.xml", "US", "en", "Macro"),
    ("BCE", "https://www.ecb.europa.eu/rss/press.html", "EU", "en", "Banques centrales"),
    ("Banque d'Angleterre", "https://www.bankofengland.co.uk/rss/news", "UK", "en", "Banques centrales"),
    ("BBC Business", "https://feeds.bbci.co.uk/news/business/rss.xml", "UK", "en", "Macro"),
    ("Guardian Economics", "https://www.theguardian.com/business/economics/rss", "UK", "en", "Macro"),
    ("Le Monde Économie", "https://www.lemonde.fr/economie/rss_full.xml", "FR", "fr", "Macro"),
    ("Le Figaro Économie", "https://www.lefigaro.fr/rss/figaro_economie.xml", "FR", "fr", "Macro"),
    ("France 24 Éco", "https://www.france24.com/fr/%C3%A9co-tech/rss", "FR", "fr", "Macro"),
]
RULES = [
    ("Banques centrales", r"\b(fed|fomc|powell|ecb|bce|lagarde|boj|boe|central bank|banque centrale|rate cut|rate hike|taux directeur|monetary policy|politique monétaire)\b"),
    ("Inflation", r"\b(inflation|cpi|pce|prix à la consommation|consumer prices|deflation)\b"),
    ("Emploi", r"\b(jobs|payrolls|unemployment|jobless|chômage|emploi|labor market)\b"),
    ("Énergie", r"\b(oil|crude|brent|opec|opep|pétrole|natural gas|gaz|energy prices)\b"),
    ("Crypto", r"\b(bitcoin|crypto|ethereum|stablecoin)\b"),
    ("Marchés", r"\b(stocks?|shares|wall street|nasdaq|s&p|dow|cac 40|bourse|treasur(y|ies)|yields?|bond|obligations?|earnings|résultats|ipo)\b"),
    ("Commerce", r"\b(tariffs?|trade war|droits de douane|exports?|imports?|sanctions)\b"),
]
TAG = re.compile(r"<[^>]+>")


def _clean(s: str, n: int = 320) -> str:
    s = re.sub(r"\s+", " ", html.unescape(TAG.sub(" ", s or ""))).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def _theme(text: str, default: str) -> str:
    t = text.lower()
    for name, pat in RULES:
        if re.search(pat, t):
            return name
    return default


def parse(name: str, url: str, country: str, lang: str, default_theme: str, symbol: str = "") -> list[dict]:
    feed = feedparser.parse(get(url).content)
    out = []
    for e in feed.entries:
        title = _clean(e.get("title", ""), 300)
        link = e.get("link", "")
        ts = e.get("published_parsed") or e.get("updated_parsed")
        if not title or not link or not ts:
            continue
        published = datetime.fromtimestamp(calendar.timegm(ts), timezone.utc)
        if published > datetime.now(timezone.utc):
            published = datetime.now(timezone.utc)
        summary = _clean(e.get("summary", ""))
        key = re.sub(r"[^a-z0-9]+", "", title.lower())  # dédoublonnage par titre normalisé
        out.append({"id": hashlib.sha1((key + symbol).encode()).hexdigest()[:16], "title": title, "link": link, "source": name,
                    "published": published.isoformat(timespec="seconds"), "summary": "" if summary == title else summary,
                    "theme": _theme(title + " " + summary, default_theme), "country": country, "lang": lang, "symbol": symbol})
    return out


def symbol_feed(symbol: str) -> list[dict]:
    url = f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={symbol}&region=US&lang=en-US"
    return parse("Yahoo Finance", url, "US", "en", "Entreprises", symbol.upper())
