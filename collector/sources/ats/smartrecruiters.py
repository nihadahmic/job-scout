"""SmartRecruiters: api.smartrecruiters.com/v1/companies/<slug>/postings

The list has no description, so details are fetched one posting at a time, but only for
remote postings whose title passes the prefilter. That keeps a 2,000-job board to a
handful of requests.
"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource
from collector.text import html_to_text, iso_from_naive

PAGE_SIZE = 100
MAX_PAGES = 10
SECTIONS = ("companyDescription", "jobDescription", "qualifications", "additionalInformation")


class SmartRecruiters(AtsSource):
    name = "smartrecruiters"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://api.smartrecruiters.com/v1/companies/{slug}/postings"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return json.loads(text).get("content") or []

    def fetch_company(self, company: dict[str, Any]) -> list[dict[str, Any]]:
        url = self.board_url(company["slug"], None)
        postings: list[dict[str, Any]] = []
        for page in range(MAX_PAGES):
            data = json.loads(
                self.client.get_text(url, params={"limit": PAGE_SIZE, "offset": page * PAGE_SIZE})
            )
            postings += data.get("content") or []
            if len(postings) >= (data.get("totalFound") or 0):
                break
        wanted = [
            p
            for p in postings
            if (p.get("location") or {}).get("remote") and self.title_ok(p.get("name") or "")
        ]
        for posting in wanted:
            posting["detail"] = json.loads(self.client.get_text(posting["ref"]))
        return wanted

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        detail = p.get("detail") or {}
        loc = p.get("location") or {}
        place = loc.get("fullLocation") or ", ".join(
            x for x in (loc.get("city"), loc.get("region"), (loc.get("country") or "").upper()) if x
        )
        sections = (detail.get("jobAd") or {}).get("sections") or {}
        description = "\n\n".join(
            html_to_text((sections.get(key) or {}).get("text")) for key in SECTIONS
        )
        remote = bool(loc.get("remote")) and not loc.get("hybrid")
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=detail.get("postingUrl") or p.get("ref") or "",
            company=raw.payload["company"],
            title=(p.get("name") or "").strip(),
            location_text=", ".join(["Remote"] * remote + [place] * bool(place)) or "Unspecified",
            remote=remote,
            posted_at=iso_from_naive((p.get("releasedDate") or "").replace("Z", "+00:00")),
            description=description.strip(),
            salary_text=None,
            apply_url=detail.get("applyUrl") or detail.get("postingUrl"),
            extra={
                "experience": (p.get("experienceLevel") or {}).get("label"),
                "employment_type": (p.get("typeOfEmployment") or {}).get("label"),
                "country": loc.get("country"),
            },
        )
