"""Copy the company watchlist from companies.yaml into Supabase (the app's Sources page).

Usage: uv run python -m scripts.import_watchlist [path/to/companies.yaml] [--dry-run]

Keeps ats, slug, region, board_name, notes and locks. Companies already in Supabase (same
website) are left as they are, so it is safe to run twice. After this, edit companies on
the Sources page; companies.yaml stays only as a fallback for local runs.
"""

from __future__ import annotations

import argparse
from collections import Counter
from pathlib import Path

from collector.supabase_store import SupabaseStore, _chunks, load_dotenv
from scripts.companies_file import DEFAULT_PATH, ROOT, load


def to_row(c: dict) -> dict:
    return {
        "name": c["name"],
        "website": c["website"],
        "ats": c.get("ats") or "unknown",
        "slug": c.get("slug"),
        "ats_region": c.get("ats_region"),
        "board_name": c.get("board_name"),
        "ats_note": c.get("ats_note"),
        "ats_locked": bool(c.get("ats_locked")),
        "detected_at": c.get("detected_at"),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, nargs="?", default=DEFAULT_PATH)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    rows = [to_row(c) for c in load(args.file) if c.get("website")]
    print(
        f"import_watchlist | {len(rows)} companies | "
        + " ".join(f"{k}={v}" for k, v in Counter(r["ats"] for r in rows).most_common())
    )
    if args.dry_run:
        return 0
    load_dotenv(ROOT / ".env")
    store = SupabaseStore.from_env()
    if store is None:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_KEY are not set")
    try:
        for chunk in _chunks(rows):
            store.client.post(
                "/watchlist",
                params={"on_conflict": "website"},
                json=chunk,
                headers={"Prefer": "resolution=ignore-duplicates,return=minimal"},
            ).raise_for_status()
        r = store.client.get(
            "/watchlist", params={"select": "id"}, headers={"Prefer": "count=exact", "Range": "0-0"}
        )
        print(
            f"import_watchlist | Supabase watchlist now has {r.headers.get('content-range', '?').split('/')[-1]} companies"
        )
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
