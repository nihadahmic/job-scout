"""BambooHR careers pages: <slug>.bamboohr.com/careers/list, details per job.

The list has no description, so details are fetched only for remote postings whose title
passes the prefilter (like SmartRecruiters). Every posting is still returned and counted.
locationType: "0" on-site, "1" remote, "2" hybrid; isRemote is set on some accounts.
"""

from __future__ import annotations

import json
from typing import Any

from collector.models import Job, RawJob
from collector.sources.ats.base import AtsSource
from collector.text import html_to_text, iso_from_naive


def _is_remote(p: dict[str, Any]) -> bool:
    return bool(p.get("isRemote")) or str(p.get("locationType")) == "1"


def _place(p: dict[str, Any]) -> str:
    ats = p.get("atsLocation") or {}
    loc = p.get("location") or {}
    parts = [
        ats.get("city") or loc.get("city"),
        ats.get("state") or loc.get("state"),
        ats.get("country"),
    ]
    return ", ".join(str(x).strip() for x in parts if x)


class BambooHR(AtsSource):
    name = "bamboohr"

    def board_url(self, slug: str, region: str | None) -> str:
        return f"https://{slug}.bamboohr.com/careers/list"

    def parse(self, text: str) -> list[dict[str, Any]]:
        return json.loads(text).get("result") or []

    def fetch_company(self, company: dict[str, Any]) -> list[dict[str, Any]]:
        postings = self.parse(self.client.get_text(self.board_url(company["slug"], None)))
        for p in postings:
            if _is_remote(p) and self.title_ok(p.get("jobOpeningName") or ""):
                detail = json.loads(
                    self.client.get_text(
                        f"https://{company['slug']}.bamboohr.com/careers/{p['id']}/detail"
                    )
                )
                p["detail"] = (detail.get("result") or {}).get("jobOpening") or {}
            p["url"] = f"https://{company['slug']}.bamboohr.com/careers/{p['id']}"
        return postings

    def normalize(self, raw: RawJob) -> Job:
        p = raw.payload["item"]
        d = p.get("detail") or {}
        remote = _is_remote(p)
        place = _place(d or p)
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=p["url"],
            company=raw.payload["company"],
            title=(p.get("jobOpeningName") or "").strip(),
            location_text=", ".join(["Remote"] * remote + [place] * bool(place)) or "Unspecified",
            remote=remote,
            posted_at=iso_from_naive(d.get("datePosted")),
            description=html_to_text(d.get("description")),
            salary_text=(d.get("compensation") or None),
            apply_url=d.get("jobOpeningShareUrl") or p["url"],
            extra={
                "department": p.get("departmentLabel"),
                "employment": p.get("employmentStatusLabel"),
            },
        )
