"""Import job applications tracked in Notion into Supabase, with their status history.

Usage: uv run python -m scripts.import_notion private/notion_applications_2026.json [--dry-run]

The JSON is an export of the Notion "Applications" database, one object per application:
  n  Notion page id            c  company           t  job title
  s  Notion stages (list)      a  applied (ISO)      e  last edited in Notion (ISO)
  u  posting URL (optional)    l  LinkedIn URL       $  salary text      o  notes
Notion's created time is the applied date. Its last-edited time stands in for the date of
the latest stage change (Notion keeps no stage history), so those dates are approximate.

An application that matches a job already in Supabase (same posting URL, or same company
and title) updates that job if it is still "new"; otherwise a job with source "notion" is
created. Safe to run twice: already-imported applications are skipped.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlparse

from collector.enrich import Enricher
from collector.run import load_config
from collector.supabase_store import SupabaseStore, _chunks, load_dotenv
from collector.text import dedupe_key

ROOT = Path(__file__).resolve().parent.parent
NOTE = "Imported from Notion"
APPROX = "Imported from Notion; date is the page's last edit in Notion, so approximate"
REPLY_STAGES = {"Interview", "Screening", "Reached Out to Me"}


def final_status(stages: list[str]) -> str:
    s = {x.strip() for x in stages}
    if "Signed ✍️" in s or "Signed" in s:
        return "accepted"
    if "Won't be moving forward" in s:
        return "not_moving_forward"
    if "Offered 😃" in s or "Offered" in s:
        return "offer"
    if s & REPLY_STAGES:
        return "interviewing"
    return "applied"


def history(app: dict) -> list[dict]:
    """Status changes for one application, oldest first."""
    final = final_status(app["s"])
    rows = [{"from_status": None, "to_status": "applied", "changed_at": app["a"], "note": NOTE}]
    reached_interview = bool(set(app["s"]) & REPLY_STAGES)
    if reached_interview and final != "interviewing":
        rows.append(
            {
                "from_status": "applied",
                "to_status": "interviewing",
                "changed_at": app["e"],
                "note": APPROX,
            }
        )
    if final != "applied":
        prev = "interviewing" if reached_interview and final != "interviewing" else "applied"
        rows.append(
            {"from_status": prev, "to_status": final, "changed_at": app["e"], "note": APPROX}
        )
    return rows


def norm_url(url: str | None) -> str | None:
    if not url:
        return None
    p = urlparse(url.strip())
    host = p.netloc.lower().removeprefix("www.")
    path = re.sub(r"/(apply|application)/?$", "", p.path.rstrip("/"))
    return f"{host}{path}".lower() if host else None


def job_row(app: dict, enricher: Enricher) -> dict:
    url = app.get("u") or app.get("l") or f"https://www.notion.so/{app['n']}"
    salary = enricher.salary(app.get("$"))
    final = final_status(app["s"])
    return {
        "id": f"notion:{app['n']}",
        "source": "notion",
        "source_id": app["n"],
        "url": url,
        "company": app["c"],
        "title": app["t"],
        "category": enricher.category(app["t"]),
        "location_text": "Not recorded (imported from Notion)",
        "location_match": None,
        "remote": False,
        "posted_at": None,
        "description": "",
        "salary_text": app.get("$"),
        "salary_min_eur_month": salary.min_eur_month if salary else None,
        "salary_max_eur_month": salary.max_eur_month if salary else None,
        "apply_url": app.get("u"),
        "first_seen_at": app["a"],
        "dedupe_key": dedupe_key(app["c"], app["t"]),
        "extra": {
            "notion_page": f"https://www.notion.so/{app['n']}",
            "notion_stages": app["s"],
            "linkedin": app.get("l"),
        },
        "status": final,
        "status_changed_at": app["e"] if final != "applied" else app["a"],
        "applied_at": app["a"],
        "notes": app.get("o"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("file", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    apps = json.loads(args.file.read_text())
    enricher = Enricher(load_config(ROOT / "config" / "rules.yaml"))
    load_dotenv(ROOT / ".env")
    store = SupabaseStore.from_env()
    if store is None:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set")

    try:
        existing = []
        offset = 0
        while True:
            r = store.client.get(
                "/jobs",
                params={
                    "select": "id,url,apply_url,dedupe_key,status,company,title",
                    "limit": 1000,
                    "offset": offset,
                },
            )
            r.raise_for_status()
            existing += r.json()
            if len(r.json()) < 1000:
                break
            offset += 1000
        by_id = {j["id"]: j for j in existing}
        by_url = {}
        for j in existing:
            for u in (j["url"], j["apply_url"]):
                if norm_url(u):
                    by_url.setdefault(norm_url(u), j)
        by_key = {}
        for j in existing:
            by_key.setdefault(j["dedupe_key"], j)

        plan = Counter()
        inserts, updates, hist = [], [], []
        for app in apps:
            if f"notion:{app['n']}" in by_id:
                plan["skip: already imported"] += 1
                continue
            match = by_url.get(norm_url(app.get("u"))) or by_key.get(dedupe_key(app["c"], app["t"]))
            if match and not match["id"].startswith("notion:"):
                if match["status"] != "new":
                    plan["skip: matching backlog job already tracked"] += 1
                    continue
                final = final_status(app["s"])
                updates.append(
                    (
                        match["id"],
                        {
                            "status": final,
                            "applied_at": app["a"],
                            "status_changed_at": app["e"] if final != "applied" else app["a"],
                            "notes": app.get("o"),
                        },
                    )
                )
                hist += [{"job_id": match["id"], **h} for h in history(app)]
                plan[f"update backlog job -> {final}"] += 1
                print(f"  match: {app['c']} / {app['t']}  ->  {match['id']}")
                continue
            row = job_row(app, enricher)
            inserts.append(row)
            hist += [{"job_id": row["id"], **h} for h in history(app)]
            plan[f"new job -> {row['status']}"] += 1

        print(
            f"import_notion | applications={len(apps)} | "
            + " | ".join(f"{k}={v}" for k, v in sorted(plan.items()))
        )
        print(f"import_notion | history rows={len(hist)}")
        if args.dry_run:
            return 0

        for chunk in _chunks(inserts):
            r = store.client.post("/jobs", json=chunk, headers={"Prefer": "return=minimal"})
            r.raise_for_status()
        for job_id, body in updates:
            r = store.client.patch(
                "/jobs", params={"id": f"eq.{job_id}", "status": "eq.new"}, json=body
            )
            r.raise_for_status()
        for chunk in _chunks(hist):
            r = store.client.post(
                "/status_history", json=chunk, headers={"Prefer": "return=minimal"}
            )
            r.raise_for_status()
        # Notion notes become dated job notes (migration 0010), on the applied date.
        inserted = {row["id"] for row in inserts}
        notes = [
            {"job_id": f"notion:{a['n']}", "created_at": a["a"], "body": a["o"], "legacy": True}
            for a in apps
            if a.get("o") and f"notion:{a['n']}" in inserted
        ]
        for chunk in _chunks(notes):
            r = store.client.post("/job_notes", json=chunk, headers={"Prefer": "return=minimal"})
            r.raise_for_status()
        print(f"import_notion | inserted={len(inserts)} updated={len(updates)} history={len(hist)}")
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
