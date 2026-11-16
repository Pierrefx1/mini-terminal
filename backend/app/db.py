import sqlite3
from contextlib import contextmanager
from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY, payload TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- AAAA-MM-JJ
  type TEXT NOT NULL,            -- BUY SELL DIVIDEND DEPOSIT WITHDRAWAL FEE SPLIT
  symbol TEXT,                   -- symbole Yahoo, vide pour les flux de trésorerie
  quantity TEXT,                 -- Decimal en texte (SPLIT : ratio, ex. 4 pour 4-pour-1)
  price TEXT,                    -- prix unitaire dans la devise de la ligne
  amount TEXT,                   -- montant brut pour DIVIDEND/DEPOSIT/WITHDRAWAL/FEE
  fees TEXT NOT NULL DEFAULT '0',
  currency TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
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
