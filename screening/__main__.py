"""Screen new jobs with Gemini. Usage: uv run python -m screening [--dry-run] [--limit N]

Needs SUPABASE_URL, SUPABASE_SERVICE_KEY and GEMINI_API_KEY (CI secrets or .env).
Without GEMINI_API_KEY it skips with a notice instead of failing the daily run.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from collector.run import load_config
from collector.supabase_store import SupabaseStore, load_dotenv
from screening.gemini import Gemini
from screening.screen import record, screen

ROOT = Path(__file__).resolve().parent.parent


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rules", type=Path, default=ROOT / "config" / "rules.yaml")
    parser.add_argument("--dry-run", action="store_true", help="print verdicts, change nothing")
    parser.add_argument("--limit", type=int, help="screen at most N jobs this run")
    args = parser.parse_args(argv)

    load_dotenv(ROOT / ".env")
    store = SupabaseStore.from_env()
    gemini = Gemini.from_env()
    if store is None:
        print("screening | skipped: Supabase is not configured")
        return 0
    if gemini is None:
        print("screening | skipped: GEMINI_API_KEY is not set")
        return 0
    rules = load_config(args.rules)
    if args.limit:
        rules.setdefault("screening", {})["max_per_run"] = args.limit
    try:
        stats = screen(store, gemini, rules, dry_run=args.dry_run)
        if not args.dry_run:
            record(store, stats)
    finally:
        gemini.close()
        store.close()
    print(stats.line())
    return 0


if __name__ == "__main__":
    sys.exit(main())
