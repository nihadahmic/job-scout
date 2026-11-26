"""Any RSS 2.0 or Atom job feed, added on the app's Sources page. No code per feed.

Feeds share one shape (title, link, date, description), so one module reads them all.
The company comes from a company field if the feed has one, else from the title
("Acme: Product Manager", "Product Manager at Acme"), else the feed's name.
"""

from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from typing import Any

from collector.http import Fetcher
from collector.models import Job, RawJob
from collector.text import html_to_text, iso_from_naive, iso_from_rfc822

# Optional fields some job feeds add (We Work Remotely, Jobicy, Working Nomads...).
EXTRA = (
    "company",
    "company_name",
    "region",
    "country",
    "location",
    "locations",
    "category",
    "type",
    "salary",
)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _text(el: ET.Element | None) -> str:
    return (el.text or "").strip() if el is not None else ""


def parse_feed(xml_text: str) -> list[dict[str, str]]:
    """RSS <item> or Atom <entry> elements as plain dicts, namespace-agnostic."""
    root = ET.fromstring(xml_text.strip().encode())
    items = []
    for el in root.iter():
        if _local(el.tag) not in ("item", "entry"):
            continue
        fields: dict[str, str] = {}
        for child in el:
            name = _local(child.tag)
            if name == "link" and child.get("href"):
                if child.get("rel", "alternate") == "alternate":
                    fields.setdefault("link", child.get("href", ""))
                continue
            value = _text(child)
            if name in ("name",) or not value and len(child):
                # Atom <author><name>…</name></author>
                value = " ".join(_text(c) for c in child if _text(c))
            if value:
                fields.setdefault(name, value)
        items.append(fields)
    return items


def split_title(title: str, company: str = "", fallback: str = "") -> tuple[str, str]:
    """(company, role) from a feed item title."""
    title = " ".join(title.split())
    if company:
        return company.strip(), title
    m = re.match(r"^([^:]{2,60}):\s+(.+)$", title)  # "Acme: Product Manager"
    if m and len(m.group(1).split()) <= 6:
        return m.group(1).strip(), m.group(2).strip()
    m = re.match(r"^(.+?)\s+(?:at|@)\s+([^,()]{2,60})$", title)  # "Product Manager at Acme"
    if m and len(m.group(2).split()) <= 6:
        return m.group(2).strip(), m.group(1).strip()
    return fallback, title


class Feeds:
    name = "feeds"

    def __init__(self, client: Fetcher, config: dict[str, Any]) -> None:
        self.client = client
        # Rows from the Sources page: {id, name, url, all_remote}.
        # Local runs can list them in config under `list`.
        self.feeds: list[dict[str, Any]] = config.get("_feeds") or config.get("list") or []
        self.errors: list[str] = []
        self.errors_by_key: dict[int, str] = {}
        self.stat_rows: list[int] = []

    def fetch(self) -> list[RawJob]:
        raws: list[RawJob] = []
        for feed in self.feeds:
            key = feed.get("id")
            if key is not None:
                self.stat_rows.append(key)
            try:
                items = parse_feed(self.client.get_text(feed["url"]))
            except Exception as exc:  # one broken feed must not stop the rest
                message = f"{type(exc).__name__}: {exc}"[:200]
                self.errors.append(f"{feed.get('name', feed['url'])}: {message}")
                if key is not None:
                    self.errors_by_key[key] = message
                continue
            seen: set[str] = set()
            for item in items:
                ident = (
                    item.get("guid") or item.get("id") or item.get("link") or item.get("title", "")
                )
                digest = hashlib.sha1(ident.encode()).hexdigest()[:12]
                if not ident or digest in seen:
                    continue
                seen.add(digest)
                raws.append(
                    RawJob(
                        self.name,
                        f"{key if key is not None else feed['url']}/{digest}",
                        {"item": item, "feed": feed, "_stat_key": key},
                    )
                )
        return raws

    def normalize(self, raw: RawJob) -> Job:
        item, feed = raw.payload["item"], raw.payload["feed"]
        company, title = split_title(
            item.get("title", ""),
            item.get("company") or item.get("company_name") or "",
            fallback=feed.get("name", ""),
        )
        location = ", ".join(
            x
            for x in (
                item.get("region"),
                item.get("country"),
                item.get("location"),
                item.get("locations"),
            )
            if x
        )
        description = (
            item.get("description")
            or item.get("content")
            or item.get("summary")
            or item.get("encoded")
            or ""
        )
        posted = (
            item.get("pubdate") or item.get("published") or item.get("updated") or item.get("date")
        )
        posted_iso = iso_from_rfc822(posted) or iso_from_naive(
            (posted or "").replace("Z", "+00:00")
        )
        all_remote = bool(feed.get("all_remote", True))
        return Job(
            source=self.name,
            source_id=raw.source_id,
            url=item.get("link") or "",
            company=company or "Unknown",
            title=title,
            location_text=location or ("Remote" if all_remote else "Unspecified"),
            remote=all_remote or "remote" in f"{title} {location}".lower(),
            posted_at=posted_iso,
            description=html_to_text(description),
            salary_text=item.get("salary") or None,
            apply_url=item.get("link") or None,
            extra={"feed": feed.get("name"), **{k: item[k] for k in EXTRA if item.get(k)}},
        )
