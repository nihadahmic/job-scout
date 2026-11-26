"""Teamtailor career sites: <slug>.teamtailor.com/jobs.rss, or <custom-domain>/jobs.rss.

remoteStatus is "fully", "hybrid", "temporary" or "none". Remote jobs keep their office
locations ("Remote, Milano, Italy"), so a single-country remote role is treated as
restricted to that country, the same as on every other source.
"""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource
from collector.text import html_to_text, iso_from_rfc822

NS = {"tt": "https://teamtailor.com/locations"}


class Teamtailor(AtsSource):
    name = "teamtailor"

    def board_url(self, slug: str, region: str | None) -> str:
        host = slug if "." in slug else f"{slug}.teamtailor.com"
        return f"https://{host}/jobs.rss"

    def parse(self, text: str) -> list[dict[str, Any]]:
        items = []
        for it in ET.fromstring(text).iter("item"):
            offices = []
            for loc in it.findall("tt:locations/tt:location", NS):
                parts = [
                    loc.findtext(f"tt:{k}", default="", namespaces=NS) for k in ("city", "country")
                ]
                offices.append(", ".join(p for p in parts if p))
            items.append(
                {
                    "id": it.findtext("guid") or it.findtext("link"),
                    "title": it.findtext("title") or "",
                    "description": it.findtext("description") or "",
                    "pubDate": it.findtext("pubDate"),
                    "link": it.findtext("link") or "",
                    "remoteStatus": (it.findtext("remoteStatus") or "").lower(),
                    "department": it.findtext("tt:department", namespaces=NS),
                    "offices": offices,
                }
            )
        return items

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        fully_remote = p["remoteStatus"] == "fully"
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p["link"],
            company=raw.payload["company"],
            title=p["title"].strip(),
            location_text=", ".join(["Remote"] * fully_remote + p["offices"]) or "Unspecified",
            remote=fully_remote,
            posted_at=iso_from_rfc822(p["pubDate"]),
            description=html_to_text(p["description"]),
            salary_text=None,
            apply_url=p["link"],
            extra={
                "remote_status": p["remoteStatus"],
                "offices": p["offices"],
                "department": p["department"],
            },
        )
