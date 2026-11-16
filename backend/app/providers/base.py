"""Interfaces des fournisseurs : une par type de donnée.

Les routeurs ne dépendent que de ces interfaces ; changer de source revient à
écrire un nouvel adaptateur et à le brancher dans `registry.py`.
"""
from typing import Protocol


class PriceProvider(Protocol):
    name: str
    def history(self, symbol: str, interval: str, range_: str) -> dict: ...
    def search(self, query: str) -> list[dict]: ...
    def quotes(self, symbols: list[str]) -> list[dict]: ...


class MacroProvider(Protocol):
    name: str
    def series(self, series_id: str, start: str | None = None) -> dict: ...


class NewsProvider(Protocol):
    name: str
    def latest(self) -> list[dict]: ...


class CalendarProvider(Protocol):
    name: str
    def events(self) -> list[dict]: ...


class ForecastProvider(Protocol):
    name: str
    def forecasts(self, country: str) -> list[dict]: ...
