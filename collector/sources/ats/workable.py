"""Workable accounts: apply.workable.com/api/v1/widget/accounts/<slug>?details=true"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource
from collector.text import html_to_text, iso_from_naive


class Workable(AtsSource):
    name = "workable"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return json.loads(text).get("jobs") or []

    def job_id(self, item: dict[str, Any]) -> str:
        return str(item["shortcode"])

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        places = []
        for loc in p.get("locations") or [{"city": p.get("city"), "country": p.get("country")}]:
            place = ", ".join(
                x for x in (loc.get("city"), loc.get("region"), loc.get("country")) if x
            )
            if place and place not in places:
                places.append(place)
        remote = bool(p.get("telecommuting"))
        location = ", ".join(["Remote"] * remote + places)
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("url") or p.get("shortlink") or "",
            company=raw.payload["company"],
            title=(p.get("title") or "").strip(),
            location_text=location or "Unspecified",
            remote=remote,
            posted_at=iso_from_naive(p.get("published_on") or p.get("created_at")),
            description=html_to_text(p.get("description")),
            salary_text=None,
            apply_url=p.get("application_url") or p.get("url"),
            extra={
                "employment_type": p.get("employment_type"),
                "experience": p.get("experience"),
                "department": p.get("department"),
            },
        )
