"""Breezy HR portals: <slug>.breezy.hr/json

The list has no description, so the authorization stage of the prefilter has nothing to
check for these jobs; screening reads the posting itself.
"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource
from collector.text import iso_from_naive

NO_RESTRICTIONS = "no location restrictions"


class Breezy(AtsSource):
    name = "breezy"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://{slug}.breezy.hr/json"

    def parse(self, text: str) -> list[dict[str, Any]]:
        data = json.loads(text)
        return data if isinstance(data, list) else []

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        locations = p.get("locations") or [p.get("location") or {}]
        remote = any(
            loc.get("is_remote") and (loc.get("remote_details") or {}).get("value") == "remote"
            for loc in locations
        )
        labels = [(loc.get("remote_details") or {}).get("label") or "" for loc in locations]
        if remote and any(NO_RESTRICTIONS in label.lower() for label in labels):
            # "Fully remote, no location restrictions" still carries the HQ country.
            location = "Anywhere (no location restrictions)"
        else:
            names = [loc.get("name") or "" for loc in locations]
            location = ", ".join(["Remote"] * remote + [n for n in names if n])
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("url") or "",
            company=raw.payload["company"],
            title=(p.get("name") or "").strip(),
            location_text=location or "Unspecified",
            remote=remote,
            posted_at=iso_from_naive((p.get("published_date") or "").replace("Z", "+00:00")),
            description="",
            salary_text=(p.get("salary") or "").strip() or None,
            apply_url=p.get("url"),
            extra={
                "remote_labels": labels,
                "type": (p.get("type") or {}).get("name"),
                "department": p.get("department"),
            },
        )
