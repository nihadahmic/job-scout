"""Himalayas public jobs API, search endpoint filtered by country.

Docs: https://himalayas.app/api. Search returns 20 jobs per page and uses ?page=N.
"""

from __future__ import annotations

import json
from typing import Any

from collector.http import Fetcher
from collector.models import Job, RawJob
from collector.text import html_to_text, iso_from_epoch

SEARCH_URL = "https://himalayas.app/jobs/api/search"
PAGE_SIZE = 20
_SHOW_ALL_COUNTRIES = 8


class Himalayas:
    name = "himalayas"

    def __init__(self, client: Fetcher, config: dict[str, Any]) -> None:
        self.client = client
        self.country: str = config.get("country", "Bosnia and Herzegovina")
        self.queries: list[str] = config.get("queries", ["product manager"])
        self.max_pages: int = int(config.get("max_pages_per_query", 3))

    def fetch(self) -> list[RawJob]:
        seen: dict[str, RawJob] = {}
        for query in self.queries:
            for page in range(1, self.max_pages + 1):
                params = {"q": query, "country": self.country, "page": page}
                data = json.loads(self.client.get_text(SEARCH_URL, params=params))
                jobs = data.get("jobs") or []
                for item in jobs:
                    if not self._open_to_country(item):
                        continue
                    raw = RawJob(self.name, _source_id(item), item)
                    seen.setdefault(raw.source_id, raw)
                if len(jobs) < PAGE_SIZE:
                    break
        return list(seen.values())

    def _open_to_country(self, item: dict[str, Any]) -> bool:
        countries = item.get("locationRestrictions") or []
        return not countries or self.country in countries

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload
        countries: list[str] = p.get("locationRestrictions") or []
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("guid") or p.get("applicationLink") or "",
            company=(p.get("companyName") or "").strip(),
            title=(p.get("title") or "").strip(),
            location_text=_location_text(countries, self.country),
            remote=True,
            posted_at=iso_from_epoch(p.get("pubDate")),
            description=html_to_text(p.get("description")),
            salary_text=_salary_text(p),
            apply_url=p.get("applicationLink"),
            extra={
                "location_restrictions": countries,
                "timezone_restrictions": p.get("timezoneRestrictions") or [],
                "seniority": p.get("seniority") or [],
                "employment_type": p.get("employmentType"),
                "categories": p.get("categories") or [],
            },
        )


def _source_id(item: dict[str, Any]) -> str:
    # guid looks like https://himalayas.app/companies/<company>/jobs/<slug>[-<number>].
    # Slugs are not always unique on their own ("manager-product-manager"), so keep the company.
    guid = (item.get("guid") or item.get("applicationLink") or "").split("?")[0].rstrip("/")
    if "/companies/" in guid and "/jobs/" in guid:
        company, slug = guid.split("/companies/", 1)[1].split("/jobs/", 1)
        return f"{company}/{slug}"
    return guid.rsplit("/", 1)[-1]


def _location_text(countries: list[str], focus: str) -> str:
    if not countries:
        return "Worldwide"
    if len(countries) <= _SHOW_ALL_COUNTRIES:
        return ", ".join(countries)
    note = f"includes {focus}" if focus in countries else f"does not include {focus}"
    return f"{len(countries)} countries ({note})"


def _salary_text(p: dict[str, Any]) -> str | None:
    lo, hi = p.get("minSalary"), p.get("maxSalary")
    if lo is None and hi is None:
        return None
    currency = p.get("currency") or ""
    period = p.get("salaryPeriod") or ""
    amount = f"{lo:,}-{hi:,}" if lo is not None and hi is not None else f"{lo or hi:,}"
    return " ".join(x for x in (currency, amount, f"/ {period}" if period else "") if x)
