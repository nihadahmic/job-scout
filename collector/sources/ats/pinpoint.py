"""Pinpoint career sites: <slug>.pinpointhq.com/postings.json (descriptions included)."""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource, salary_from_range
from collector.text import html_to_text

SECTIONS = ("description", "key_responsibilities", "skills_knowledge_expertise", "benefits")


class Pinpoint(AtsSource):
    name = "pinpoint"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://{slug}.pinpointhq.com/postings.json"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return json.loads(text).get("data") or []

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        loc = p.get("location") or {}
        place = ", ".join(
            x
            for x in (loc.get("city") or loc.get("name"), loc.get("province"), loc.get("country"))
            if x
        )
        workplace = (p.get("workplace_type") or "").lower()  # remote, hybrid, onsite
        remote = workplace == "remote"
        text = "\n\n".join(
            f"{p.get(f'{k}_header') or ''}\n{html_to_text(p.get(k))}".strip()
            for k in SECTIONS
            if p.get(k)
        )
        salary = None
        if p.get("compensation_visible"):
            salary = salary_from_range(
                p.get("compensation_minimum"),
                p.get("compensation_maximum"),
                p.get("compensation_currency"),
                p.get("compensation_frequency"),
            )
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p.get("url") or "",
            company=raw.payload["company"],
            title=(p.get("title") or "").strip(),
            location_text=", ".join(["Remote"] * remote + [place] * bool(place)) or "Unspecified",
            remote=remote,
            posted_at=None,
            description=text,
            salary_text=salary,
            apply_url=p.get("url"),
            extra={"workplace_type": workplace, "employment_type": p.get("employment_type_text")},
        )
