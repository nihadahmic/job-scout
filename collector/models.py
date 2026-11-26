"""Data shapes shared by every source."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class RawJob:
    """One listing as the source returned it, before normalization."""

    source: str
    source_id: str
    payload: dict[str, Any]


@dataclass
class Job:
    """Normalized listing. Field names match the `jobs` table and the future Supabase schema."""

    source: str
    source_id: str
    url: str
    company: str
    title: str
    location_text: str
    remote: bool
    posted_at: str | None
    description: str
    salary_text: str | None
    apply_url: str | None
    first_seen_at: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    # Filled in by the collector for jobs that pass the prefilter (collector/enrich.py)
    category: str | None = None
    location_match: str | None = None
    salary_min_eur_month: float | None = None
    salary_max_eur_month: float | None = None

    @property
    def id(self) -> str:
        return f"{self.source}:{self.source_id}"

    def to_row(self) -> dict[str, Any]:
        row = asdict(self)
        row["id"] = self.id
        return row
