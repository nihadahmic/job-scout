"""Ashby job boards: api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource
from collector.text import iso_from_naive


class Ashby(AtsSource):
    name = "ashby"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return [j for j in json.loads(text).get("jobs") or [] if j.get("isListed", True)]

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        locations = [p.get("location")] + [
            s.get("location") for s in p.get("secondaryLocations") or []
        ]
        location = ", ".join(x for x in locations if x)
        workplace = (p.get("workplaceType") or "").lower()
        comp = p.get("compensation") or {}
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("jobUrl") or "",
            company=raw.payload["company"],
            title=(p.get("title") or "").strip(),
            location_text=location or "Unspecified",
            # isRemote is also true for hybrid roles, so workplaceType decides when present.
            remote=workplace == "remote" or (not workplace and bool(p.get("isRemote"))),
            posted_at=iso_from_naive(p.get("publishedAt")),
            description=(p.get("descriptionPlain") or "").strip(),
            salary_text=comp.get("compensationTierSummary")
            or comp.get("scrapeableCompensationSalarySummary"),
            apply_url=p.get("applyUrl") or p.get("jobUrl"),
            extra={
                "workplace_type": workplace,
                "employment_type": p.get("employmentType"),
                "department": p.get("department"),
            },
        )
