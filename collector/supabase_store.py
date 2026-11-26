"""Supabase store: same interface as store.Store, over Supabase's REST API (PostgREST).

REST over HTTPS works from GitHub Actions, where the direct Postgres connection (IPv6
only) does not. The collector uses the secret key, which bypasses row-level security;
the review app never sees that key.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from pathlib import Path
from typing import Any

import httpx

from collector.models import Job
from collector.text import dedupe_key

CHUNK = 100  # ids per "in.(...)" filter, keeps URLs well under length limits


def load_dotenv(path: Path) -> None:
    """Minimal .env reader for local runs. Real environment variables win."""
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _in(values: Iterable[str]) -> str:
    quoted = ",".join('"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"' for v in values)
    return f"in.({quoted})"


def _chunks(items: list, size: int = CHUNK):
    for i in range(0, len(items), size):
        yield items[i : i + size]


class SupabaseStore:
    def __init__(self, url: str, key: str, transport: httpx.BaseTransport | None = None) -> None:
        headers = {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # legacy service_role JWT also goes in Authorization
            headers["Authorization"] = f"Bearer {key}"
        self.client = httpx.Client(
            base_url=url.rstrip("/") + "/rest/v1", headers=headers, timeout=60, transport=transport
        )

    @classmethod
    def from_env(cls) -> SupabaseStore | None:
        url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        return cls(url, key) if url and key else None

    def _existing(self, column: str, values: list[str]) -> set[str]:
        found: set[str] = set()
        for chunk in _chunks(sorted(set(values))):
            r = self.client.get("/jobs", params={"select": column, column: _in(chunk)})
            r.raise_for_status()
            found.update(row[column] for row in r.json())
        return found

    def add_many(self, jobs: list[Job], seen_at: str) -> list[str]:
        """Insert new jobs. Returns 'new', 'known' (same id) or 'duplicate' for each job."""
        if not jobs:
            return []
        keys = [dedupe_key(j.company, j.title) for j in jobs]
        known_ids = self._existing("id", [j.id for j in jobs])
        known_keys = self._existing("dedupe_key", keys)

        outcomes, rows = [], []
        for job, key in zip(jobs, keys, strict=True):
            if job.id in known_ids:
                outcomes.append("known")
            elif key in known_keys:
                outcomes.append("duplicate")
            else:
                outcomes.append("new")
                known_ids.add(job.id)
                known_keys.add(key)  # catches duplicates within this batch too
                rows.append(_row(job, key, seen_at))
        for chunk in _chunks(rows):
            r = self.client.post(
                "/jobs",
                params={"on_conflict": "id"},
                json=chunk,
                headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            )
            r.raise_for_status()
        return outcomes

    def mark_dropped(self, job_id: str, reason: str) -> None:
        self.mark_dropped_many({job_id: reason})

    def mark_dropped_many(self, reasons: dict[str, str]) -> int:
        """Set dropped_reason on stored, unscreened, untouched jobs. Returns rows changed."""
        by_reason: dict[str, list[str]] = {}
        for job_id, reason in reasons.items():
            by_reason.setdefault(reason, []).append(job_id)
        changed = 0
        for reason, ids in by_reason.items():
            for chunk in _chunks(ids):
                r = self.client.patch(
                    "/jobs",
                    params={
                        "id": _in(chunk),
                        "dropped_reason": "is.null",
                        "tier": "is.null",
                        "status": "eq.new",
                    },
                    json={"dropped_reason": reason},
                    headers={"Prefer": "return=representation"},
                )
                r.raise_for_status()
                changed += len(r.json())
        return changed

    def unscreened(self, include_dropped: bool = False) -> list[dict[str, Any]]:
        """Stored jobs the rules may still change: not screened, status new.

        With include_dropped, jobs the prefilter dropped earlier are included too, so a
        loosened preference can bring them back.
        """
        rows, offset = [], 0
        params: dict[str, Any] = {
            "select": "id,source,source_id,url,company,title,location_text,remote,"
            "posted_at,description,salary_text,apply_url,extra,dropped_reason",
            "tier": "is.null",
            "status": "eq.new",
            "order": "id",
            "limit": 1000,
        }
        if not include_dropped:
            params["dropped_reason"] = "is.null"
        while True:
            r = self.client.get("/jobs", params={**params, "offset": offset})
            r.raise_for_status()
            page = r.json()
            rows += page
            if len(page) < 1000:
                return rows
            offset += 1000

    def restore_many(self, matches: dict[str, str | None]) -> int:
        """Clear dropped_reason on jobs that pass the rules again, setting location_match."""
        by_match: dict[str | None, list[str]] = {}
        for job_id, match in matches.items():
            by_match.setdefault(match, []).append(job_id)
        changed = 0
        for match, ids in by_match.items():
            for chunk in _chunks(ids):
                r = self.client.patch(
                    "/jobs",
                    params={
                        "id": _in(chunk),
                        "dropped_reason": "not.is.null",
                        "tier": "is.null",
                        "status": "eq.new",
                    },
                    json={"dropped_reason": None, "location_match": match},
                    headers={"Prefer": "return=representation"},
                )
                r.raise_for_status()
                changed += len(r.json())
        return changed

    def load_preferences(self) -> dict[str, Any] | None:
        """The owner's profile preferences, or None if no profile has been saved."""
        r = self.client.get("/profile", params={"select": "preferences", "limit": 1})
        r.raise_for_status()
        rows = r.json()
        return rows[0]["preferences"] if rows else None

    def record_run(self, started_at: str, finished_at: str, summary: dict) -> None:
        r = self.client.post(
            "/runs",
            json={"started_at": started_at, "finished_at": finished_at, "summary": summary},
            headers={"Prefer": "return=minimal"},
        )
        r.raise_for_status()

    def count(self) -> int:
        r = self.client.get(
            "/jobs", params={"select": "id"}, headers={"Prefer": "count=exact", "Range": "0-0"}
        )
        r.raise_for_status()
        return int(r.headers.get("content-range", "*/0").split("/")[-1])

    def commit(self) -> None:  # every call above is already its own transaction
        pass

    def close(self) -> None:
        self.client.close()


def _row(job: Job, key: str, seen_at: str) -> dict[str, Any]:
    return {
        "id": job.id,
        "source": job.source,
        "source_id": job.source_id,
        "url": job.url,
        "company": job.company,
        "title": job.title,
        "category": job.category,
        "location_text": job.location_text,
        "location_match": job.location_match,
        "remote": job.remote,
        "posted_at": job.posted_at,
        "description": job.description,
        "salary_text": job.salary_text,
        "salary_min_eur_month": job.salary_min_eur_month,
        "salary_max_eur_month": job.salary_max_eur_month,
        "apply_url": job.apply_url,
        "first_seen_at": seen_at,
        "dedupe_key": key,
        "extra": job.extra,
    }
