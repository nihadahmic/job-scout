"""Remotive public API. One call a day; Remotive asks for at most four.

Terms: link back to the Remotive URL and credit Remotive as the source.
"""

from __future__ import annotations

import json
from typing import Any

from collector.http import Fetcher
from collector.models import Job, RawJob
from collector.text import html_to_text, iso_from_naive

DEFAULT_URL = "https://remotive.com/api/remote-jobs"


class Remotive:
    name = "remotive"

    def __init__(self, client: Fetcher, config: dict[str, Any]) -> None:
        self.client = client
        self.url: str = config.get("url", DEFAULT_URL)

    def fetch(self) -> list[RawJob]:
        data = json.loads(self.client.get_text(self.url))
        return [RawJob(self.name, str(item["id"]), item) for item in data.get("jobs") or []]

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("url") or "",
            company=(p.get("company_name") or "").strip(),
            title=(p.get("title") or "").strip(),
            location_text=(p.get("candidate_required_location") or "").strip() or "Unspecified",
            remote=True,
            posted_at=iso_from_naive(p.get("publication_date")),
            description=html_to_text(p.get("description")),
            salary_text=(p.get("salary") or "").strip() or None,
            apply_url=p.get("url"),
            extra={
                "category": p.get("category"),
                "job_type": p.get("job_type"),
                "tags": p.get("tags") or [],
            },
        )
