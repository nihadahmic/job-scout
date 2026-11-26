"""Fields derived from a kept job for the review app's filters: category and salary in EUR."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

_CURRENCY_SYMBOLS = {"€": "EUR", "$": "USD", "£": "GBP"}
_NUMBER = re.compile(r"(\d+(?:[.,]\d+)*)\s*([kK])?(?![\w%])")
_PERIODS = [
    ("hour", re.compile(r"\b(hour|hr|hourly|ph)\b|/\s*h\b", re.I)),
    ("day", re.compile(r"\b(day|daily)\b", re.I)),
    ("week", re.compile(r"\b(week|weekly|wk)\b", re.I)),
    ("month", re.compile(r"\b(month|monthly|mo|mth)\b", re.I)),
    ("year", re.compile(r"\b(year|yearly|annual|annually|yr|pa|per[-\s]year)\b", re.I)),
]


@dataclass(frozen=True)
class SalaryRange:
    min_eur_month: float
    max_eur_month: float


class Enricher:
    def __init__(self, rules: dict[str, Any]) -> None:
        self.categories = [
            (name, re.compile(pattern, re.I))
            for name, pattern in (rules.get("categories") or {}).items()
        ]
        salary = rules.get("salary") or {}
        self.fx = {k.upper(): float(v) for k, v in (salary.get("fx_to_eur") or {"EUR": 1}).items()}
        self.hours = float(salary.get("hours_per_month", 160))
        self.days = float(salary.get("days_per_month", 20))

    def category(self, title: str) -> str | None:
        for name, pattern in self.categories:
            if pattern.search(title):
                return name
        return None

    def salary(self, text: str | None) -> SalaryRange | None:
        """Parse "EUR 70,000-90,000 / annual", "$50-$75 /hour", "€4.5k/month" and similar."""
        if not text:
            return None
        currency = self._currency(text)
        if currency is None or currency not in self.fx:
            return None
        amounts = [_amount(n, k) for n, k in _NUMBER.findall(text)]
        amounts = [a for a in amounts if a and a >= 5][:2]
        if not amounts:
            return None
        lo, hi = min(amounts), max(amounts)
        factor = self._monthly_factor(text, hi) * self.fx[currency]
        return SalaryRange(round(lo * factor), round(hi * factor))

    def _currency(self, text: str) -> str | None:
        codes = re.findall(r"\b([A-Z]{3})\b", text.upper())
        for code in codes:
            if code in self.fx:
                return code
        for symbol, code in _CURRENCY_SYMBOLS.items():
            if symbol in text:
                return code
        return None

    def _monthly_factor(self, text: str, top: float) -> float:
        for period, pattern in _PERIODS:
            if pattern.search(text):
                return {
                    "hour": self.hours,
                    "day": self.days,
                    "week": 52 / 12,
                    "month": 1,
                    "year": 1 / 12,
                }[period]
        # No period given: guess from the size of the number.
        if top >= 15_000:
            return 1 / 12
        if top >= 1_000:
            return 1
        return self.hours


def _amount(number: str, k: str) -> float | None:
    if k:
        # "35,3k" and "3.5k": the separator is a decimal point
        value = float(number.replace(",", "."))
        return value * 1000
    if re.fullmatch(r"\d{1,3}([.,]\d{3})+", number):
        return float(re.sub(r"[.,]", "", number))
    try:
        return float(number.replace(",", "."))
    except ValueError:
        return None
