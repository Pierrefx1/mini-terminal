import sqlite3
from contextlib import contextmanager
from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, payload TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS watchlist (
  symbol TEXT PRIMARY KEY, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS news (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, link TEXT NOT NULL, source TEXT NOT NULL, published TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '', theme TEXT NOT NULL, country TEXT NOT NULL, lang TEXT NOT NULL, symbol TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS news_published ON news(published DESC);
CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, country TEXT NOT NULL, time TEXT NOT NULL,   -- time : ISO UTC
  impact TEXT NOT NULL, forecast TEXT NOT NULL DEFAULT '', previous TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_time ON calendar_events(time);
CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL);
-- Une ligne par sous-jacent et par séance (date de New York) : dernière surface calculée ce jour-là
CREATE TABLE IF NOT EXISTS vol_history (
  ticker TEXT NOT NULL, date TEXT NOT NULL, spot REAL, atm30 REAL, skew30 REAL, fly30 REAL, atm90 REAL, skew90 REAL,
  n_points INTEGER, updated_at TEXT NOT NULL, PRIMARY KEY (ticker, date)
);
-- GDELT : quarts d'heure traités (n = -1 : fichier jamais publié), agrégats par pays, événements marquants
CREATE TABLE IF NOT EXISTS gdelt_slots (slot TEXT PRIMARY KEY, n INTEGER NOT NULL, fetched_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS gdelt_country (
  slot TEXT NOT NULL, iso TEXT NOT NULL, events INTEGER NOT NULL, conflict INTEGER NOT NULL, material INTEGER NOT NULL,
  articles INTEGER NOT NULL, tone_sum REAL NOT NULL, PRIMARY KEY (slot, iso)
);
CREATE TABLE IF NOT EXISTS gdelt_events (
  id TEXT PRIMARY KEY, slot TEXT NOT NULL, iso TEXT NOT NULL, root TEXT NOT NULL, quad INTEGER NOT NULL, goldstein REAL NOT NULL,
  articles INTEGER NOT NULL, tone REAL NOT NULL, place TEXT NOT NULL, precise INTEGER NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
  actor1 TEXT NOT NULL, actor2 TEXT NOT NULL, url TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS gdelt_events_slot ON gdelt_events(slot);
-- État de chaque source de données : dernier succès, dernière erreur, compteurs (alimenté par cache.cached)
CREATE TABLE IF NOT EXISTS source_health (
  source TEXT PRIMARY KEY, last_ok TEXT, last_error_at TEXT, last_error TEXT,
  ok_count INTEGER NOT NULL DEFAULT 0, err_count INTEGER NOT NULL DEFAULT 0, last_ms INTEGER
);
"""


@contextmanager
def conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH, timeout=30)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    try:
        yield c
        c.commit()
    finally:
        c.close()


def init():
    with conn() as c:
        c.executescript(SCHEMA)
        # migrations légères : colonnes ajoutées après la création des bases existantes
        cols = {r["name"] for r in c.execute("PRAGMA table_info(news)")}
        if "image" not in cols:
            c.execute("ALTER TABLE news ADD COLUMN image TEXT NOT NULL DEFAULT ''")
        cols = {r["name"] for r in c.execute("PRAGMA table_info(calendar_events)")}
        if "actual" not in cols:  # chiffre publié, rapproché depuis Nasdaq (ForexFactory ne le donne pas)
            c.execute("ALTER TABLE calendar_events ADD COLUMN actual TEXT NOT NULL DEFAULT ''")
