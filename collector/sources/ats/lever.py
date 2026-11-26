"""Lever postings: api.lever.co/v0/postings/<slug>?mode=json (api.eu.lever.co for EU boards)."""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource, salary_from_range
from collector.text import html_to_text, iso_from_epoch


class Lever(AtsSource):
    name = "lever"

    def board_url(self, slug: str, region: str | None) -> str:
        host = "api.eu.lever.co" if region == "eu" else "api.lever.co"
        return f"https://{host}/v0/postings/{slug}?mode=json"

    def parse(self, text: str) -> list[dict[str, Any]]:
        data = json.loads(text)
        return data if isinstance(data, list) else []

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        cats = p.get("categories") or {}
        locations = cats.get("allLocations") or [cats.get("location")]
        location = ", ".join(x for x in locations if x)
        lists = "\n\n".join(
            f"{block.get('text', '')}\n{html_to_text(block.get('content'))}"
            for block in p.get("lists") or []
        )
        description = "\n\n".join(
            x for x in (p.get("descriptionPlain"), lists, p.get("additionalPlain")) if x
        )
        salary = p.get("salaryRange") or {}
        workplace = (p.get("workplaceType") or "").lower()
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("hostedUrl") or "",
            company=raw.payload["company"],
            title=(p.get("text") or "").strip(),
            location_text=location or "Unspecified",
            remote=workplace == "remote"
            or (workplace in ("", "unspecified") and "remote" in location.lower()),
            posted_at=iso_from_epoch((p.get("createdAt") or 0) / 1000 or None),
            description=description.strip(),
            salary_text=salary_from_range(
                salary.get("min"), salary.get("max"), salary.get("currency"), salary.get("interval")
            ),
            apply_url=p.get("applyUrl") or p.get("hostedUrl"),
            extra={
                "workplace_type": workplace,
                "country": p.get("country"),
                "commitment": cats.get("commitment"),
                "team": cats.get("team"),
            },
        )
