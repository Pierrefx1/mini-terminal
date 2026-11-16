import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI

from . import config, db
from .routers import calendar, crypto, data, forecasts, macro, market, news, portfolio, screener

log = logging.getLogger("mini-terminal")


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
    sched.start()
    yield
    sched.shutdown(wait=False)


app = FastAPI(title="mini-terminal", lifespan=lifespan)
for r in (market, macro, portfolio, news, calendar, screener, data, forecasts, crypto):
    app.include_router(r.router)


@app.get("/api/status")
def status():
    return {"base_currency": config.BASE_CURRENCY, "benchmark": config.BENCHMARK,
            "keys": {"fred": bool(config.FRED_API_KEY), "finnhub": bool(config.FINNHUB_API_KEY)}}
