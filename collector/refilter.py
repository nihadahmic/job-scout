"""Re-apply config/rules.yaml to stored jobs nobody has screened or touched yet.

Usage: uv run python -m collector.refilter [--db data/jobs.sqlite] [--dry-run]

The daily run filters jobs before storing them, so this is only needed after the rules
change (or once, for rows stored before the prefilter existed). Jobs that no longer pass
get dropped_reason set; nothing is deleted, and jobs with a status other than "new" are
never touched.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from collector.models import Job
from collector.prefilter import Prefilter
from collector.store import Store
from collector.supabase_store import SupabaseStore, load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def job_from_row(row: dict) -> Job:
    return Job(
        source=row["source"],
        source_id=row["source_id"],
        url=row.get("url") or "",
        company=row.get("company") or "",
        title=row.get("title") or "",
        location_text=row.get("location_text") or "",
        remote=bool(row.get("remote")),
        posted_at=row.get("posted_at"),
        description=row.get("description") or "",
        salary_text=row.get("salary_text"),
        apply_url=row.get("apply_url"),
        extra=row.get("extra") or {},
    )


def refilter(store, prefilter: Prefilter, dry_run: bool = False) -> Counter:
    reasons = {}
    for row in store.unscreened():
        verdict = prefilter.check(job_from_row(row))
        if not verdict.keep:
            reasons[row["id"]] = verdict.reason
    if reasons and not dry_run:
        store.mark_dropped_many(reasons)
        store.commit()
    return Counter(reasons.values())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, help="SQLite file instead of Supabase")
    parser.add_argument("--rules", type=Path, default=ROOT / "config" / "rules.yaml")
    parser.add_argument("--dry-run", action="store_true", help="count, change nothing")
    args = parser.parse_args(argv)

    load_dotenv(ROOT / ".env")
    store = None if args.db else SupabaseStore.from_env()
    store = store or Store(args.db or ROOT / "data" / "jobs.sqlite")
    try:
        counts = refilter(store, Prefilter.from_file(args.rules), args.dry_run)
    finally:
        store.close()
    detail = ", ".join(f"{r}={n}" for r, n in counts.most_common()) or "none"
    verb = "would drop" if args.dry_run else "dropped"
    print(f"refilter | {verb}={sum(counts.values())} | {detail}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
