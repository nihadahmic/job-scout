"""One-time copy of a SQLite jobs database into Supabase.

Usage: uv run python -m scripts.migrate_to_supabase PATH/TO/jobs.sqlite [--dry-run]

Keeps each row's id and first_seen_at, fills the fields added for the review app
(category, location_match, EUR salary range), and sets dropped_reason on rows the
current rules would drop. Safe to run twice: rows that already exist are skipped.
Needs SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment or .env.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path

from collector.enrich import Enricher
from collector.prefilter import Prefilter
from collector.refilter import job_from_row
from collector.run import load_config
from collector.supabase_store import SupabaseStore, _chunks, _row, load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def read_sqlite(path: Path) -> tuple[list[dict], list[dict]]:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    jobs = [dict(r) for r in conn.execute("SELECT * FROM jobs ORDER BY first_seen_at, id")]
    runs = [
        dict(r)
        for r in conn.execute("SELECT started_at, finished_at, summary FROM runs ORDER BY id")
    ]
    conn.close()
    for row in jobs:
        row["extra"] = json.loads(row.get("extra") or "{}")
    for run in runs:
        run["summary"] = json.loads(run["summary"])
    return jobs, runs


def build_rows(
    jobs: list[dict], prefilter: Prefilter, enricher: Enricher
) -> tuple[list[dict], Counter]:
    rows, dropped = [], Counter()
    for old in jobs:
        job = job_from_row(old)
        verdict = prefilter.check(job)
        job.category = enricher.category(job.title)
        job.location_match = prefilter.location_match(job) if verdict.keep else None
        salary = enricher.salary(job.salary_text)
        if salary:
            job.salary_min_eur_month, job.salary_max_eur_month = (
                salary.min_eur_month,
                salary.max_eur_month,
            )
        row = _row(job, old["dedupe_key"], old["first_seen_at"])
        reason = old.get("dropped_reason") or (None if verdict.keep else verdict.reason)
        row["dropped_reason"] = reason
        if reason:
            dropped[reason] += 1
        rows.append(row)
    return rows, dropped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sqlite", type=Path)
    parser.add_argument("--rules", type=Path, default=ROOT / "config" / "rules.yaml")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    rules = load_config(args.rules)
    jobs, runs = read_sqlite(args.sqlite)
    rows, dropped = build_rows(jobs, Prefilter(rules), Enricher(rules))
    kept = len(rows) - sum(dropped.values())
    detail = ", ".join(f"{r}={n}" for r, n in dropped.most_common()) or "none"
    total_dropped = sum(dropped.values())
    print(f"migrate | rows={len(rows)} kept={kept} dropped={total_dropped} ({detail})")
    print(f"migrate | runs={len(runs)}")
    if args.dry_run:
        return 0

    load_dotenv(ROOT / ".env")
    store = SupabaseStore.from_env()
    if store is None:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set")
    try:
        before = store.count()
        for chunk in _chunks(rows):
            r = store.client.post(
                "/jobs",
                params={"on_conflict": "id"},
                json=chunk,
                headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            )
            r.raise_for_status()
        if before == 0:  # copy run history only into an empty project, so reruns don't repeat it
            for run in runs:
                store.record_run(run["started_at"], run["finished_at"], run["summary"])
        print(f"migrate | supabase jobs before={before} after={store.count()}")
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
