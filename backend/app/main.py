import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI

from . import cache, config, db, geo_risk
from .cache import record_health
from .routers import (analysis, calendar, collab, commodities, crypto, data, forecasts, fx, macro, market, news, overview,
                      portfolio, rates_fx, recap, screener, vol, world)

log = logging.getLogger("market-terminal")


def _safe(fn):
    name = f"Tâche planifiée : {fn.__module__.rsplit('.', 1)[-1]}.{fn.__name__}"

    def run():
        t0 = time.monotonic()
        try:
            fn()
            record_health(name, True, None, time.monotonic() - t0)
        except Exception as e:  # une source en panne ne doit pas arrêter le planificateur
            log.warning("tâche %s en échec : %s", fn.__module__, e)
            record_health(name, False, f"{type(e).__name__}: {e}", time.monotonic() - t0)
    return run


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    collab.init()
    sched = BackgroundScheduler(timezone="Europe/Paris")
    sched.add_job(_safe(news.refresh), "interval", minutes=5, id="news")
    sched.add_job(_safe(calendar.refresh), "interval", minutes=60, id="calendar")
    # GDELT : rattrapage des 8 derniers jours au démarrage (~20 s), puis les nouveaux quarts d'heure toutes les 5 min
    sched.add_job(_safe(geo_risk.sync), "interval", minutes=5, id="gdelt", next_run_time=datetime.now(timezone.utc), max_instances=1)
    sched.add_job(_safe(recap.refresh), "cron", hour=recap.HOUR, minute=recap.MINUTE, id="recap", misfire_grace_time=3600)
    # Capture VOL 30 min avant la clôture US (bid/ask encore publiés), heure de New York pour suivre les changements d'heure
    sched.add_job(_safe(vol.snapshot_watchlist), "cron", day_of_week="mon-fri", hour=15, minute=30, timezone="America/New_York",
                  id="vol_snapshot", misfire_grace_time=1200)
    sched.start()
    yield
    sched.shutdown(wait=False)


app = FastAPI(title="MARKET TERMINAL", lifespan=lifespan)
for r in (overview, market, macro, news, calendar, screener, data, forecasts, crypto, recap,
          commodities, rates_fx, fx, analysis, portfolio, collab, vol, world):
    app.include_router(r.router)


@app.get("/api/status/sources")
def sources():
    """État de chaque source : dernier succès, dernière erreur, compteurs depuis la création de la base."""
    with db.conn() as c:
        rows = [dict(r) for r in c.execute("SELECT * FROM source_health ORDER BY source")]
    return {"sources": rows, "retries": cache.pending_retries(), "now": datetime.now(timezone.utc).isoformat(timespec="seconds")}


@app.get("/api/status")
def status():
    return {"keys": {"fred": bool(config.FRED_API_KEY), "finnhub": bool(config.FINNHUB_API_KEY), "gemini": bool(config.GEMINI_API_KEY), "eia": bool(config.EIA_API_KEY)}}
