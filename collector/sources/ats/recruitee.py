"""Recruitee careers sites: <slug>.recruitee.com/api/offers/"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource, salary_from_range
from collector.text import html_to_text, iso_from_naive


class Recruitee(AtsSource):
    name = "recruitee"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://{slug}.recruitee.com/api/offers/"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return [
            o
            for o in json.loads(text).get("offers") or []
            if o.get("status", "published") == "published"
        ]

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        locations = [loc.get("name") or "" for loc in p.get("locations") or []]
        location = p.get("location") or ", ".join(x for x in locations if x)
        salary = p.get("salary") or {}
        published = (p.get("published_at") or p.get("created_at") or "").replace(" UTC", "")
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("careers_url") or "",
            company=raw.payload["company"],
            title=(p.get("title") or "").strip(),
            location_text=location or "Unspecified",
            remote=bool(p.get("remote")) and not p.get("hybrid") and not p.get("on_site"),
            posted_at=iso_from_naive(published.replace(" ", "T")),
            description=html_to_text(f"{p.get('description') or ''}{p.get('requirements') or ''}"),
            salary_text=salary_from_range(
                salary.get("min"), salary.get("max"), salary.get("currency"), salary.get("period")
            ),
            apply_url=p.get("careers_apply_url") or p.get("careers_url"),
            extra={
                "country_code": p.get("country_code"),
                "employment_type": p.get("employment_type_code"),
                "experience": p.get("experience_code"),
            },
        )
