"""Personio career sites: <slug>.jobs.personio.de/xml

Personio has no workplace field. Remote roles say so in the office name ("EU Remote | Berlin",
"Remote - Germany"), so the office names are both the location and the remote signal.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource, contains_remote
from collector.text import html_to_text, iso_from_naive


class Personio(AtsSource):
    name = "personio"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://{slug}.jobs.personio.de/xml"

    def fetch_company(self, company: dict[str, Any]) -> list[dict[str, Any]]:
        items = super().fetch_company(company)
        for item in items:
            item["url"] = f"https://{company['slug']}.jobs.personio.de/job/{item['id']}"
        return items

    def parse(self, text: str) -> list[dict[str, Any]]:
        items = []
        for pos in ET.fromstring(text).iter("position"):
            offices = [pos.findtext("office") or ""]
            offices += [o.text or "" for o in pos.findall("additionalOffices/office")]
            sections = [
                f"{d.findtext('name') or ''}\n{html_to_text(d.findtext('value'))}"
                for d in pos.findall("jobDescriptions/jobDescription")
            ]
            items.append(
                {
                    "id": pos.findtext("id"),
                    "title": pos.findtext("name") or "",
                    "offices": [o.strip() for o in offices if o.strip()],
                    "description": "\n\n".join(sections),
                    "created_at": pos.findtext("createdAt"),
                    "department": pos.findtext("department"),
                    "seniority": pos.findtext("seniority"),
                    "employment_type": pos.findtext("employmentType"),
                }
            )
        return items

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p["url"],
            company=raw.payload["company"],
            title=p["title"].strip(),
            location_text=", ".join(p["offices"]) or "Unspecified",
            remote=contains_remote(*p["offices"]),
            posted_at=iso_from_naive(p["created_at"]),
            description=p["description"].strip(),
            salary_text=None,
            apply_url=p["url"],
            extra={
                "department": p["department"],
                "seniority": p["seniority"],
                "employment_type": p["employment_type"],
            },
        )
