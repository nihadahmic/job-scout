"""Greenhouse job boards: boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource, contains_remote
from collector.text import html_to_text, iso_from_naive


class Greenhouse(AtsSource):
    name = "greenhouse"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return json.loads(text).get("jobs") or []

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        location = ((p.get("location") or {}).get("name") or "").strip()
        offices = [o.get("location") or o.get("name") or "" for o in p.get("offices") or []]
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("absolute_url") or "",
            company=raw.payload["company"],
            title=(p.get("title") or "").strip(),
            location_text=location or "Unspecified",
            # Greenhouse has no workplace field; "Remote" in the location is the convention.
            remote=contains_remote(location, *offices),
            posted_at=iso_from_naive(p.get("first_published") or p.get("updated_at")),
            description=html_to_text(p.get("content")),
            salary_text=None,
            apply_url=p.get("absolute_url"),
            extra={
                "offices": offices,
                "departments": [d.get("name") for d in p.get("departments") or []],
            },
        )
