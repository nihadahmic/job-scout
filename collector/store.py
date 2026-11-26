"""SQLite storage. Columns match the schema planned for Supabase so migration is a straight copy."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from collector.models import Job
from collector.text import dedupe_key

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id              TEXT PRIMARY KEY,          -- "<source>:<source_id>"
    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    url             TEXT NOT NULL,
    company         TEXT NOT NULL,
    title           TEXT NOT NULL,
    location_text   TEXT,
    remote          INTEGER NOT NULL,
    posted_at       TEXT,
    description     TEXT,
    salary_text     TEXT,
    apply_url       TEXT,
    first_seen_at   TEXT NOT NULL,
    dedupe_key      TEXT NOT NULL,
    extra           TEXT,                      -- JSON, source-specific fields
    category        TEXT,
    location_match  TEXT,
    salary_min_eur_month REAL,
    salary_max_eur_month REAL,
    -- screening (step 2)
    tier            INTEGER,
    fit             INTEGER,
    fit_reason      TEXT,
    eligibility_note TEXT,
    dropped_reason  TEXT,
    -- review (step 3+)
    status          TEXT NOT NULL DEFAULT 'new',
    status_changed_at TEXT,
    notes           TEXT,
    cover_letter    TEXT,
    answers         TEXT,                      -- JSON
    salary_answer   TEXT,
    applied_at      TEXT,
    reply           TEXT NOT NULL DEFAULT 'none'
);
CREATE INDEX IF NOT EXISTS jobs_dedupe_key ON jobs (dedupe_key);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs (status);

CREATE TABLE IF NOT EXISTS runs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT NOT NULL,
    finished_at TEXT NOT NULL,
    summary     TEXT NOT NULL                  -- JSON, per-source counts
);
"""

_JOB_COLUMNS = (
    "id",
    "source",
    "source_id",
    "url",
    "company",
    "title",
    "location_text",
    "remote",
    "posted_at",
    "description",
    "salary_text",
    "apply_url",
    "first_seen_at",
    "dedupe_key",
    "extra",
    "category",
    "location_match",
    "salary_min_eur_month",
    "salary_max_eur_month",
)
# Columns added after the first schema; older local databases get them on open.
_ADDED_COLUMNS = {
    "category": "TEXT",
    "location_match": "TEXT",
    "salary_min_eur_month": "REAL",
    "salary_max_eur_month": "REAL",
    "status_changed_at": "TEXT",
    "notes": "TEXT",
}


class Store:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path)
        self.conn.executescript(SCHEMA)
        have = {r[1] for r in self.conn.execute("PRAGMA table_info(jobs)")}
        for column, kind in _ADDED_COLUMNS.items():
            if column not in have:
                self.conn.execute(f"ALTER TABLE jobs ADD COLUMN {column} {kind}")

    def add(self, job: Job, seen_at: str) -> str:
        """Insert a job if it is new. Returns 'new', 'known' (same id) or 'duplicate'."""
        if self.conn.execute("SELECT 1 FROM jobs WHERE id = ?", (job.id,)).fetchone():
            return "known"
        key = dedupe_key(job.company, job.title)
        if self.conn.execute("SELECT 1 FROM jobs WHERE dedupe_key = ?", (key,)).fetchone():
            return "duplicate"
        row = job.to_row()
        row.update(
            first_seen_at=seen_at,
            dedupe_key=key,
            remote=int(job.remote),
            extra=json.dumps(job.extra, ensure_ascii=False, sort_keys=True),
        )
        placeholders = ", ".join("?" for _ in _JOB_COLUMNS)
        self.conn.execute(
            f"INSERT INTO jobs ({', '.join(_JOB_COLUMNS)}) VALUES ({placeholders})",
            tuple(row[c] for c in _JOB_COLUMNS),
        )
        return "new"

    def add_many(self, jobs: list[Job], seen_at: str) -> list[str]:
        return [self.add(job, seen_at) for job in jobs]

    def mark_dropped(self, job_id: str, reason: str) -> None:
        """Set dropped_reason on an already stored, not yet screened job."""
        self.conn.execute(
            "UPDATE jobs SET dropped_reason = ? "
            "WHERE id = ? AND dropped_reason IS NULL AND tier IS NULL AND status = 'new'",
            (reason, job_id),
        )

    def mark_dropped_many(self, reasons: dict[str, str]) -> int:
        before = self.conn.total_changes
        for job_id, reason in reasons.items():
            self.mark_dropped(job_id, reason)
        return self.conn.total_changes - before

    def unscreened(self, include_dropped: bool = False) -> list[dict]:
        self.conn.row_factory = sqlite3.Row
        where = "tier IS NULL AND status = 'new'"
        if not include_dropped:
            where += " AND dropped_reason IS NULL"
        try:
            rows = self.conn.execute(f"SELECT * FROM jobs WHERE {where}").fetchall()
        finally:
            self.conn.row_factory = None
        out = []
        for r in rows:
            row = dict(r)
            row["extra"] = json.loads(row.get("extra") or "{}")
            row["remote"] = bool(row["remote"])
            out.append(row)
        return out

    def restore_many(self, matches: dict[str, str | None]) -> int:
        before = self.conn.total_changes
        for job_id, match in matches.items():
            self.conn.execute(
                "UPDATE jobs SET dropped_reason = NULL, location_match = ? "
                "WHERE id = ? AND dropped_reason IS NOT NULL AND tier IS NULL AND status = 'new'",
                (match, job_id),
            )
        return self.conn.total_changes - before

    def load_preferences(self) -> dict | None:
        return None  # local SQLite runs have no profile; rules.yaml applies as is

    def record_run(self, started_at: str, finished_at: str, summary: dict) -> None:
        self.conn.execute(
            "INSERT INTO runs (started_at, finished_at, summary) VALUES (?, ?, ?)",
            (started_at, finished_at, json.dumps(summary, sort_keys=True)),
        )

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()
