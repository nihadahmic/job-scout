"""Shared loop for ATS sources: one request per company board, errors kept per company."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

from collector.http import Fetcher
from collector.models import Job, RawJob

log = logging.getLogger("collector.ats")
ROOT = Path(__file__).resolve().parents[3]
DEFAULT_WATCHLIST = ROOT / "private" / "companies.yaml"


def load_watchlist(path: Path) -> list[dict[str, Any]]:
    with path.open() as f:
        return (yaml.safe_load(f) or {}).get("companies") or []


class AtsSource:
    """Subclasses set `name` and implement board_url(), parse() and normalize()."""

    name = "ats"

    def __init__(self, client: Fetcher, config: dict[str, Any]) -> None:
        self.client = client
        self.config = config
        self.watchlist = Path(config.get("companies_file") or DEFAULT_WATCHLIST)
        if not self.watchlist.is_absolute():
            self.watchlist = ROOT / self.watchlist
        self.max_companies = config.get("max_companies")
        # Set by the collector so sources that need one request per job can skip
        # obvious non-matches before fetching details.
        self.title_ok = config.get("_title_ok") or (lambda title: True)
        self.errors: list[str] = []
        self.companies_checked = 0

    def companies(self) -> list[dict[str, Any]]:
        if not self.watchlist.exists():
            raise FileNotFoundError(f"watchlist not found: {self.watchlist}")
        rows = [
            c for c in load_watchlist(self.watchlist) if c.get("ats") == self.name and c.get("slug")
        ]
        return rows[: self.max_companies] if self.max_companies else rows

    def fetch(self) -> list[RawJob]:
        raws: list[RawJob] = []
        for company in self.companies():
            self.companies_checked += 1
            try:
                items = self.fetch_company(company)
            except Exception as exc:  # one broken board must not stop the rest
                self.errors.append(f"{company['slug']}: {type(exc).__name__}: {exc}"[:200])
                continue
            for item in items:
                job_id = self.job_id(item)
                raws.append(
                    RawJob(
                        self.name,
                        f"{company['slug']}/{job_id}",
                        {
                            "item": item,
                            # board_name: set when the board belongs to a parent or new brand
                            "company": company.get("board_name") or company["name"],
                            "slug": company["slug"],
                        },
                    )
                )
        return raws

    def fetch_company(self, company: dict[str, Any]) -> list[dict[str, Any]]:
        text = self.client.get_text(self.board_url(company["slug"], company.get("ats_region")))
        return self.parse(text)

    # To implement per ATS:
    def board_url(self, slug: str, region: str | None) -> str:
        raise NotImplementedError

    def parse(self, text: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    def job_id(self, item: dict[str, Any]) -> str:
        return str(item["id"])

    def normalize(self, raw: RawJob) -> Job:
        raise NotImplementedError


def contains_remote(*values: str | None) -> bool:
    return any("remote" in (v or "").lower() for v in values)


def salary_from_range(lo, hi, currency: str | None, period: str | None) -> str | None:
    if lo is None and hi is None:
        return None
    amount = f"{lo:,}-{hi:,}" if lo is not None and hi is not None else f"{lo or hi:,}"
    return " ".join(x for x in (currency, amount, f"/ {period}" if period else None) if x)
