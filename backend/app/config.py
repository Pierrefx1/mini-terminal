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
# Modèles essayés dans l'ordre si le principal est saturé (503/504) ou ne répond pas à temps.
RECAP_FALLBACKS = [m.strip() for m in os.getenv("RECAP_FALLBACKS", "gemini-3.7-flash,gemini-3.5-flash").split(",") if m.strip()]
GEMINI_TIMEOUT = float(os.getenv("GEMINI_TIMEOUT", "90"))  # secondes par tentative
USER_AGENT = "market-terminal/0.2"
# La SEC refuse les requêtes sans User-Agent identifiable ; un contact réel est recommandé (voir .env.example).
# La SEC exige un User-Agent identifiant l'utilisateur (« Nom email@domaine ») : pas de valeur par défaut partagée
SEC_USER_AGENT = os.getenv("SEC_USER_AGENT", "").strip()
