"""Turn a page of the Notion "Applications" database into job fields. Pure, no network."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from urllib.parse import parse_qs, urlparse

UNKNOWN_COMPANY = "Unknown company"
_COUNT_PREFIX = re.compile(r"^\(\d+\)\s*")
_HIRING = re.compile(r"^(?P<company>.+?) hiring (?P<title>.+?)(?: in (?P<place>.+))?$", re.I)
_PARENS = re.compile(r"^(?P<company>[^()]+?)\s*\((?P<title>[^()]+)\)$")


@dataclass
class Page:
    page_id: str  # no dashes, as the earlier import stored it
    title: str
    company: str
    posting_url: str | None
    linkedin_url: str | None
    stages: list[str]
    salary_text: str | None
    notes: str | None
    created: str
    edited: str
    positions: list[str] = field(default_factory=list)

    @property
    def job_id(self) -> str:
        return f"notion:{self.page_id}"

    @property
    def url(self) -> str:
        if self.posting_url:
            return self.posting_url
        li = linkedin_job_id(self.linkedin_url)
        if li:
            return f"https://www.linkedin.com/jobs/view/{li}/"
        return self.linkedin_url or f"https://www.notion.so/{self.page_id}"


def linkedin_job_id(url: str | None) -> str | None:
    if not url:
        return None
    p = urlparse(url)
    if "linkedin.com" not in p.netloc.lower():
        return None
    m = re.search(r"/jobs/view/(?:[^/]*?-)?(\d{6,})", p.path)
    if m:
        return m.group(1)
    q = parse_qs(p.query)
    for key in ("currentJobId", "jobId"):
        if q.get(key) and q[key][0].isdigit():
            return q[key][0]
    return None


def split_role(raw: str, positions: list[str] | None = None) -> tuple[str, str | None]:
    """Title and company from the page title, as you and LinkedIn write them.

    "Paddle (Product Marketing Manager)"                     -> title, "Paddle"
    "Project Manager - Software Development at Zact Inc."    -> title, "Zact Inc."
    "Senior Product Manager | Acme | LinkedIn"               -> title, "Acme"
    "Acme hiring Senior Product Manager in Berlin | LinkedIn" -> title, "Acme"
    "Acme" with Position "Product Lead"                      -> "Product Lead", "Acme"
    """
    text = _COUNT_PREFIX.sub("", " ".join(raw.split()))
    parts = [p.strip() for p in text.split("|") if p.strip()]
    if parts and parts[-1].lower() == "linkedin":
        parts = parts[:-1]
    if len(parts) >= 2:
        return parts[0], parts[1]
    one = parts[0] if parts else ""
    for pattern in (_HIRING, _PARENS):
        m = pattern.match(one)
        if m:
            return m.group("title").strip(), m.group("company").strip()
    if " at " in one:
        title, company = one.rsplit(" at ", 1)
        return title.strip(), company.strip()
    if positions:
        return positions[0], one or None
    return one or "Untitled job", None


def _plain(prop: dict | None) -> str:
    if not prop:
        return ""
    kind = prop.get("type")
    if kind in ("title", "rich_text"):
        return "".join(t.get("plain_text", "") for t in prop.get(kind) or []).strip()
    if kind == "url":
        return (prop.get("url") or "").strip()
    if kind in ("select", "status"):
        return ((prop.get(kind) or {}).get("name") or "").strip()
    return ""


def _multi(prop: dict | None) -> list[str]:
    if not prop:
        return []
    if prop.get("type") == "multi_select":
        return [o["name"] for o in prop.get("multi_select") or []]
    one = _plain(prop)
    return [one] if one else []


def parse_page(page: dict) -> Page:
    props = page.get("properties", {})
    title_prop = next((p for p in props.values() if p.get("type") == "title"), None)
    positions = _multi(props.get("Position"))
    title, company = split_role(_plain(title_prop), positions)
    return Page(
        page_id=page["id"].replace("-", ""),
        title=title[:300],
        company=(company or UNKNOWN_COMPANY)[:200],
        posting_url=_plain(props.get("Posting URL")) or None,
        linkedin_url=_plain(props.get("Linkedin Job Post")) or None,
        stages=_multi(props.get("Stage")),
        salary_text=_plain(props.get("Salary Range")) or None,
        notes=_plain(props.get("Notes (Reason, etc.)")) or None,
        created=page["created_time"],
        edited=page["last_edited_time"],
        positions=positions,
    )
