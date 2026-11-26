"""One-time: give closed jobs a close_reason after migration 0004.

Usage: uv run python -m scripts.backfill_close_reasons [--dry-run]

Rejections that went through an interview get "Rejected after interview", the rest
"Rejected after applying". Specific jobs can be closed with a reason via FIXES below.
Only fills empty reasons, so it is safe to run twice.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from collector.supabase_store import SupabaseStore, _chunks, _in, load_dotenv

ROOT = Path(__file__).resolve().parent.parent

# Jobs whose Notion stage didn't say closed, but whose notes did. Closed at the given time.
FIXES = {
    # TryHackMe reached out, then filled the role before the first call (from the Notion note)
    "notion:33731f749c5380ed9c7cf0e600b0dfb4": ("Role filled or closed", "2026-05-20T14:46:30Z"),
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    load_dotenv(ROOT / ".env")
    store = SupabaseStore.from_env()
    if store is None:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set")
    c = store.client
    try:
        closed = c.get(
            "/jobs",
            params={
                "select": "id,status",
                "status": "eq.not_moving_forward",
                "close_reason": "is.null",
                "limit": 5000,
            },
        ).json()
        interviewed = set()
        for chunk in _chunks([j["id"] for j in closed]):
            rows = c.get(
                "/status_history",
                params={"select": "job_id", "job_id": _in(chunk), "to_status": "eq.interviewing"},
            ).json()
            interviewed.update(r["job_id"] for r in rows)
        plan = {
            j["id"]: "Rejected after interview"
            if j["id"] in interviewed
            else "Rejected after applying"
            for j in closed
        }
        print("backfill | " + " | ".join(f"{r}={n}" for r, n in Counter(plan.values()).items()))

        fixes = []
        for job_id, (reason, at) in FIXES.items():
            job = c.get(
                "/jobs", params={"select": "id,status,close_reason", "id": f"eq.{job_id}"}
            ).json()
            if job and job[0]["status"] not in ("not_moving_forward", "withdrawn", "declined"):
                fixes.append((job[0], reason, at))
                print(f"backfill | close {job_id} ({job[0]['status']}): {reason}")
        if args.dry_run:
            return 0

        by_reason: dict[str, list[str]] = {}
        for job_id, reason in plan.items():
            by_reason.setdefault(reason, []).append(job_id)
        for reason, ids in by_reason.items():
            for chunk in _chunks(ids):
                c.patch(
                    "/jobs",
                    params={"id": _in(chunk), "close_reason": "is.null"},
                    json={"close_reason": reason},
                ).raise_for_status()
                c.patch(
                    "/status_history",
                    params={
                        "job_id": _in(chunk),
                        "to_status": "eq.not_moving_forward",
                        "reason": "is.null",
                    },
                    json={"reason": reason},
                ).raise_for_status()
        for job, reason, at in fixes:
            c.patch(
                "/jobs",
                params={"id": f"eq.{job['id']}"},
                json={
                    "status": "not_moving_forward",
                    "close_reason": reason,
                    "status_changed_at": at,
                },
            ).raise_for_status()
            c.post(
                "/status_history",
                json={
                    "job_id": job["id"],
                    "from_status": job["status"],
                    "to_status": "not_moving_forward",
                    "reason": reason,
                    "note": "From the Notion note: filled before the first call",
                    "changed_at": at,
                },
            ).raise_for_status()
        print(f"backfill | reasons set={len(plan)} closed={len(fixes)}")
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
