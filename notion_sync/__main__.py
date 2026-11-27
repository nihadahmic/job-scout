"""Sync the Notion "Applications" database. Usage: uv run python -m notion_sync [--since DATE]

Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, NOTION_TOKEN (a read-only integration shared with
that database only) and NOTION_DATA_SOURCE_ID. Without the Notion ones it skips with a
notice. Prints counts only, so the public Actions log shows nothing about your jobs.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from collector.enrich import Enricher
from collector.run import load_config
from collector.supabase_store import SupabaseStore, load_dotenv
from notion_sync.notion import Notion
from notion_sync.sync import NotionSync

ROOT = Path(__file__).resolve().parent.parent


def record(store: SupabaseStore, stats: dict) -> None:
    """Add the counts to today's run, so the Runs page shows them."""
    r = store.client.get(
        "/runs", params={"select": "id,summary", "order": "started_at.desc", "limit": 1}
    )
    r.raise_for_status()
    if not r.json():
        return
    row = r.json()[0]
    summary = row["summary"]
    summary.setdefault("_meta", {})["notion"] = stats
    store.client.patch(
        "/runs", params={"id": f"eq.{row['id']}"}, json={"summary": summary}
    ).raise_for_status()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", default="2026-01-01", help="only pages created from this date")
    parser.add_argument("--dry-run", action="store_true", help="read everything, write nothing")
    args = parser.parse_args(argv)

    load_dotenv(ROOT / ".env")
    store = SupabaseStore.from_env()
    notion = Notion.from_env()
    source = os.environ.get("NOTION_DATA_SOURCE_ID")
    if store is None:
        print("notion | skipped: Supabase is not configured")
        return 0
    if notion is None or not source:
        print("notion | skipped: NOTION_TOKEN or NOTION_DATA_SOURCE_ID is not set")
        return 0
    try:
        r = store.client.get(
            "/source_settings", params={"source": "eq.notion", "select": "enabled"}
        )
        r.raise_for_status()
        if r.json() and r.json()[0]["enabled"] is False:
            print("notion | skipped: switched off on the Sources page")
            return 0
        enricher = Enricher(load_config(ROOT / "config" / "rules.yaml"))
        stats = NotionSync(store, notion, enricher, dry_run=args.dry_run).run(source, args.since)
        if not args.dry_run:
            record(store, stats.as_dict())
        print(stats.line() + (" (dry run, nothing written)" if args.dry_run else ""))
    finally:
        notion.close()
        store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
