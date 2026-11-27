"""Sync the Notion "Applications" database into Supabase. Notion -> app, forward only.

New page, no stage or "Ready to Apply" -> a job in the Backlog (source "notion"); screening
    scores it and puts it in To apply. If another source already has the job, that one is
    put in To apply instead of adding a copy.
New page with a stage (Applied, Interview, ...) -> the job at that status, with history.
Stage changed later -> the job moves forward (Applied -> Interviewing -> Offer) or closes
    ("Won't be moving forward"). It never moves backwards, and a job you closed in the
    app is never reopened.
Title, company or a pasted description changed while the job is still saved -> updated.
Only pages created on or after `since` are read (default 2026-01-01, like the first import).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from collector.enrich import Enricher
from collector.supabase_store import SupabaseStore, _chunks
from collector.text import dedupe_key, utc_now
from notion_sync.notion import Notion
from notion_sync.parse import Page, parse_page
from notion_sync.stages import close_reason, final_status, is_saved, steps

JOB_FIELDS = "id,source,status,url,apply_url,dedupe_key,title,company,description"
NOTE = "From Notion"


@dataclass
class Stats:
    pages: int = 0
    counts: Counter = field(default_factory=Counter)
    errors: int = 0

    def line(self) -> str:
        parts = "".join(f" {k}={v}" for k, v in sorted(self.counts.items()))
        return f"notion | pages={self.pages}{parts} errors={self.errors}"

    def as_dict(self) -> dict[str, Any]:
        return {"pages": self.pages, **self.counts, "errors": self.errors}


def _time(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _norm(url: str | None) -> str | None:
    if not url:
        return None
    u = url.strip().lower().split("#")[0].rstrip("/")
    return u.removeprefix("https://").removeprefix("http://").removeprefix("www.") or None


class _DryClient:
    """Reads go to Supabase; writes are only counted. For --dry-run."""

    def __init__(self, client: Any) -> None:
        self._client = client

    def get(self, *a: Any, **kw: Any) -> Any:
        return self._client.get(*a, **kw)

    def _fake(self, method: str, path: str) -> Any:
        import httpx

        return httpx.Response(200, json=[{}], request=httpx.Request(method, f"https://dry{path}"))

    def post(self, path: str, **kw: Any) -> Any:
        return self._fake("POST", path)

    def patch(self, path: str, **kw: Any) -> Any:
        return self._fake("PATCH", path)


class NotionSync:
    def __init__(
        self, store: SupabaseStore, notion: Notion, enricher: Enricher, dry_run: bool = False
    ) -> None:
        self.store, self.notion, self.enricher = store, notion, enricher
        if dry_run:
            self.store = type("DryStore", (), {"client": _DryClient(store.client)})()
        self.stats = Stats()
        self.jobs: dict[str, dict[str, Any]] = {}
        self.by_url: dict[str, dict[str, Any]] = {}
        self.by_key: dict[str, dict[str, Any]] = {}

    # --- Supabase -----------------------------------------------------------------------
    def _all(self, path: str, select: str) -> list[dict[str, Any]]:
        rows, offset = [], 0
        while True:
            r = self.store.client.get(
                path,
                params={
                    "select": select,
                    "order": "id" if path == "/jobs" else "page_id",
                    "limit": 1000,
                    "offset": offset,
                },
            )
            r.raise_for_status()
            rows += r.json()
            if len(r.json()) < 1000:
                return rows
            offset += 1000

    def load(self) -> dict[str, dict[str, Any]]:
        for j in self._all("/jobs", JOB_FIELDS):
            self._index(j)
        return {row["page_id"]: row for row in self._all("/notion_pages", "*")}

    def _index(self, job: dict[str, Any]) -> None:
        self.jobs[job["id"]] = job
        for u in (job.get("url"), job.get("apply_url")):
            if _norm(u):
                self.by_url.setdefault(_norm(u), job)
        self.by_key.setdefault(job["dedupe_key"], job)

    def find_match(self, page: Page) -> dict[str, Any] | None:
        """The job imported from this page before, or the same job from another source."""
        if page.job_id in self.jobs:
            return self.jobs[page.job_id]
        for u in (page.posting_url, page.url):
            if _norm(u) in self.by_url:
                return self.by_url[_norm(u)]
        if not page.company.startswith("Unknown"):
            return self.by_key.get(dedupe_key(page.company, page.title))
        return None

    def history(self, rows: list[dict[str, Any]]) -> None:
        for chunk in _chunks(rows):
            self.store.client.post(
                "/status_history", json=chunk, headers={"Prefer": "return=minimal"}
            ).raise_for_status()

    def advance(
        self, job: dict[str, Any], page: Page, at: str, applied_at: str | None = None
    ) -> bool:
        """Move the job forward to what Notion's stages say. Returns True if it moved.
        `applied_at` dates the "applied" step when it differs from the latest change."""
        target = final_status(page.stages)
        path = steps(job["status"], target, page.stages)
        if not path:
            return False
        applied_at = applied_at or at
        patch: dict[str, Any] = {"status": target, "status_changed_at": at, "dropped_reason": None}
        if "applied" in path:
            patch["applied_at"] = applied_at
        reason = close_reason(target, "interviewing" in path or job["status"] == "interviewing")
        if reason:
            patch["close_reason"] = reason
        r = self.store.client.patch(
            "/jobs",
            params={"id": f"eq.{job['id']}", "status": f"eq.{job['status']}"},
            json=patch,
            headers={"Prefer": "return=representation"},
        )
        r.raise_for_status()
        if not r.json():
            return False  # changed in the app meanwhile; the app wins
        prev, rows = job["status"], []
        for to in path:
            rows.append(
                {
                    "job_id": job["id"],
                    "from_status": prev,
                    "to_status": to,
                    "note": NOTE,
                    "changed_at": applied_at if to == "applied" else at,
                    **({"reason": reason} if to == target and reason else {}),
                }
            )
            prev = to
        self.history(rows)
        job["status"] = target
        self.stats.counts[f"to_{target}"] += 1
        return True

    def shortlist(self, job: dict[str, Any]) -> None:
        if job["status"] != "new":
            return
        at = utc_now()
        r = self.store.client.patch(
            "/jobs",
            params={"id": f"eq.{job['id']}", "status": "eq.new"},
            json={"status": "shortlisted", "status_changed_at": at, "dropped_reason": None},
            headers={"Prefer": "return=representation"},
        )
        r.raise_for_status()
        if r.json():
            self.history(
                [
                    {
                        "job_id": job["id"],
                        "from_status": "new",
                        "to_status": "shortlisted",
                        "note": "Saved in Notion",
                        "changed_at": at,
                    }
                ]
            )
            job["status"] = "shortlisted"
            self.stats.counts["to_shortlisted"] += 1

    def insert(self, page: Page) -> dict[str, Any]:
        saved = is_saved(page.stages)
        salary = self.enricher.salary(page.salary_text)
        row = {
            "id": page.job_id,
            "source": "notion",
            "source_id": page.page_id,
            "url": page.url,
            "company": page.company,
            "title": page.title,
            "category": self.enricher.category(page.title),
            "location_text": None,
            "location_match": None,
            "remote": False,
            "posted_at": None,
            "description": self.notion.body_text(page.page_id) if saved else "",
            "salary_text": page.salary_text,
            "salary_min_eur_month": salary.min_eur_month if salary else None,
            "salary_max_eur_month": salary.max_eur_month if salary else None,
            "apply_url": page.posting_url,
            "first_seen_at": page.created,
            "dedupe_key": dedupe_key(page.company, page.title),
            "extra": {
                "notion_page": f"https://www.notion.so/{page.page_id}",
                "notion_stages": page.stages,
                "linkedin": page.linkedin_url,
            },
            "status": "new",
        }
        self.store.client.post(
            "/jobs", json=row, headers={"Prefer": "return=minimal"}
        ).raise_for_status()
        job = {k: row[k] for k in JOB_FIELDS.split(",")}
        self._index(job)
        if page.notes:
            self.store.client.post(
                "/job_notes",
                json={"job_id": page.job_id, "created_at": page.created, "body": page.notes},
                headers={"Prefer": "return=minimal"},
            ).raise_for_status()
        self.stats.counts["new_saved" if saved else "new_tracked"] += 1
        if not saved:
            # Created with a stage: you applied when you made the page; later stages are
            # dated by the page's last edit (Notion keeps no stage history).
            later = page.edited if final_status(page.stages) != "applied" else page.created
            self.advance(job, page, later, applied_at=page.created)
        return job

    def new_page(self, page: Page) -> str:
        job = self.find_match(page)
        if job is None:
            return self.insert(page)["id"]
        if job["id"] != page.job_id:
            self.stats.counts["matched"] += 1
        if is_saved(page.stages):
            self.shortlist(job)
        else:
            self.advance(job, page, page.edited)
        return job["id"]

    def edited_page(self, page: Page, seen: dict[str, Any]) -> None:
        job = self.jobs.get(seen["job_id"])
        if job is None:
            return
        if sorted(page.stages) != sorted(seen.get("stages") or []):
            if is_saved(page.stages):
                self.shortlist(job)
            else:
                self.advance(job, page, page.edited)
        if job["source"] == "notion" and job["status"] in {"new", "shortlisted"}:
            patch: dict[str, Any] = {}
            if page.title != job["title"] or page.company != job["company"]:
                patch |= {
                    "title": page.title,
                    "company": page.company,
                    "dedupe_key": dedupe_key(page.company, page.title),
                    "category": self.enricher.category(page.title),
                }
            body = self.notion.body_text(page.page_id)
            if len(body) > len(job.get("description") or "") + 20:
                # a fuller description: screen it again
                patch |= {
                    "description": body,
                    "tier": None,
                    "screened_at": None,
                    "screening_error": None,
                }
            if patch:
                self.store.client.patch(
                    "/jobs", params={"id": f"eq.{job['id']}"}, json=patch
                ).raise_for_status()
                job.update({k: v for k, v in patch.items() if k in job})
                self.stats.counts["updated"] += 1

    # --- run ----------------------------------------------------------------------------
    def run(self, data_source_id: str, since: str | None = "2026-01-01") -> Stats:
        known = self.load()
        pages = self.notion.pages(data_source_id, since)
        self.stats.pages = len(pages)
        for raw in pages:
            page = parse_page(raw)
            seen = known.get(page.page_id)
            if seen and not seen.get("job_id"):
                seen = None  # its first import failed; try again
            if (
                seen
                and seen.get("page_edited_at")
                and _time(seen["page_edited_at"]) >= _time(page.edited)
            ):
                continue
            row: dict[str, Any] = {
                "page_id": page.page_id,
                "stages": page.stages,
                "page_edited_at": page.edited,
                "synced_at": utc_now(),
                "last_error": None,
            }
            try:
                if seen is None:
                    row["job_id"] = self.new_page(page)
                else:
                    self.edited_page(page, seen)
            except Exception as e:  # one bad page never stops the rest
                self.stats.errors += 1
                row["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                row.pop("page_edited_at")  # retry next run
                row.pop("stages")
            self.store.client.post(
                "/notion_pages",
                params={"on_conflict": "page_id"},
                json=row,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
            ).raise_for_status()
        return self.stats
