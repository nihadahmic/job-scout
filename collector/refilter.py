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
from collector.prefilter import STAGES, Prefilter
from collector.profile_rules import apply_profile, describe
from collector.run import load_config
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


def refilter(store, prefilter: Prefilter, dry_run: bool = False) -> tuple[Counter, int]:
    """Re-apply the rules to stored, unscreened jobs.

    Drops jobs that no longer pass (sets dropped_reason) and restores jobs the prefilter
    dropped earlier that pass now. Jobs dropped for another reason (screening, later) are
    left alone. Returns (dropped by reason, number restored).
    """
    drop: dict[str, str] = {}
    restore: dict[str, str | None] = {}
    for row in store.unscreened(include_dropped=True):
        job = job_from_row(row)
        verdict = prefilter.check(job)
        previous = row.get("dropped_reason")
        if previous is None and not verdict.keep:
            drop[row["id"]] = verdict.reason
        elif previous and verdict.keep and previous.split(":", 1)[0] in STAGES:
            restore[row["id"]] = prefilter.location_match(job)
    if not dry_run:
        if drop:
            store.mark_dropped_many(drop)
        if restore:
            store.restore_many(restore)
        store.commit()
    return Counter(drop.values()), len(restore)


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
        rules = load_config(args.rules)
        prefs = store.load_preferences()
        counts, restored = refilter(store, Prefilter(apply_profile(rules, prefs)), args.dry_run)
    finally:
        store.close()
    detail = ", ".join(f"{r}={n}" for r, n in counts.most_common()) or "none"
    prefix = "would " if args.dry_run else ""
    print(f"refilter | {describe(prefs)}")
    print(f"refilter | {prefix}drop={sum(counts.values())} ({detail}) | {prefix}restore={restored}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
