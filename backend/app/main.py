import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI

from . import config, db
from .routers import calendar, crypto, data, forecasts, macro, market, news, overview, recap, screener

log = logging.getLogger("market-terminal")


def _safe(fn):
    def run():
        try:
            fn()
        except Exception as e:  # une source en panne ne doit pas arrêter le planificateur
            log.warning("tâche %s en échec : %s", fn.__module__, e)
    return run


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    sched = BackgroundScheduler(timezone="Europe/Paris")
    sched.add_job(_safe(news.refresh), "interval", minutes=5, id="news")
    sched.add_job(_safe(calendar.refresh), "interval", minutes=60, id="calendar")
    sched.add_job(_safe(recap.refresh), "cron", hour=recap.HOUR, minute=recap.MINUTE, id="recap", misfire_grace_time=3600)
    sched.start()
    yield
    sched.shutdown(wait=False)


app = FastAPI(title="MARKET TERMINAL", lifespan=lifespan)
for r in (overview, market, macro, news, calendar, screener, data, forecasts, crypto, recap):
    app.include_router(r.router)


@app.get("/api/status")
def status():
    return {"keys": {"fred": bool(config.FRED_API_KEY), "finnhub": bool(config.FINNHUB_API_KEY), "gemini": bool(config.GEMINI_API_KEY)}}
