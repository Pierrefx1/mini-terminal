import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

DB_PATH = Path(os.getenv("DB_PATH", ROOT / "data" / "terminal.db"))
FRED_API_KEY = os.getenv("FRED_API_KEY", "").strip()
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "").strip()
EIA_API_KEY = os.getenv("EIA_API_KEY", "").strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
RECAP_MODEL = os.getenv("RECAP_MODEL", "gemini-3.8-flash").strip()
USER_AGENT = "market-terminal/0.2"
