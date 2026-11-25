"""We Work Remotely category RSS feeds."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from typing import Any

from collector.http import Fetcher
from collector.models import Job, RawJob
from collector.text import html_to_text, iso_from_rfc822

_FIELDS = (
    "title",
    "region",
    "country",
    "state",
    "skills",
    "category",
    "type",
    "description",
    "pubDate",
    "expires_at",
    "guid",
    "link",
)


class WeWorkRemotely:
    name = "weworkremotely"

    def __init__(self, client: Fetcher, config: dict[str, Any]) -> None:
        self.client = client
        self.feeds: list[str] = config.get(
            "feeds", ["https://weworkremotely.com/categories/remote-product-jobs.rss"]
        )

    def fetch(self) -> list[RawJob]:
        seen: dict[str, RawJob] = {}
        for feed in self.feeds:
            root = ET.fromstring(self.client.get_text(feed))
            for item in root.iter("item"):
                payload = {f: (item.findtext(f) or "").strip() for f in _FIELDS}
                source_id = _source_id(payload)
                if source_id:
                    seen.setdefault(source_id, RawJob(self.name, source_id, payload))
        return list(seen.values())

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload
        company, title = _split_title(p["title"])
        location = ", ".join(x for x in (p["region"], p["country"], p["state"]) if x)
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p["link"] or p["guid"],
            company=company,
            title=title,
            location_text=location or "Unspecified",
            remote=True,
            posted_at=iso_from_rfc822(p["pubDate"]),
            description=html_to_text(p["description"]),
            salary_text=None,
            apply_url=p["link"] or p["guid"],
            extra={"category": p["category"], "type": p["type"], "skills": p["skills"]},
        )


def _source_id(payload: dict[str, str]) -> str:
    url = payload.get("guid") or payload.get("link") or ""
    return url.rstrip("/").rsplit("/", 1)[-1]


def _split_title(raw_title: str) -> tuple[str, str]:
    """WWR titles look like 'Company: Role title'."""
    if ": " in raw_title:
        company, title = raw_title.split(": ", 1)
        return company.strip(), title.strip()
    return "", raw_title.strip()
