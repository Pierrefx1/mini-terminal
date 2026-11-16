import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DB_PATH = Path(os.getenv("DB_PATH", ROOT / "data" / "terminal.db"))
FRED_API_KEY = os.getenv("FRED_API_KEY", "").strip()
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "").strip()
BASE_CURRENCY = os.getenv("BASE_CURRENCY", "EUR").strip().upper()
BENCHMARK = os.getenv("BENCHMARK", "URTH").strip()
USER_AGENT = "mini-terminal/0.1 (usage personnel)"
