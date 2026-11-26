"""Entry point: `uv run python -m collector`."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from collector.enrich import Enricher
from collector.http import HttpClient
from collector.prefilter import Prefilter
from collector.profile_rules import apply_profile, describe
from collector.refilter import refilter
from collector.run import collect, load_config, source_lines, summary_line
from collector.sources import SOURCES
from collector.store import Store
from collector.supabase_store import SupabaseStore, load_dotenv

ROOT = Path(__file__).resolve().parent.parent


def store_path(args) -> str:
    return f"sqlite {args.db or 'data/jobs.sqlite'}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="collector", description=__doc__)
    parser.add_argument("--config", type=Path, default=ROOT / "config" / "sources.yaml")
    parser.add_argument("--rules", type=Path, default=ROOT / "config" / "rules.yaml")
    parser.add_argument(
        "--companies",
        type=Path,
        help="company watchlist for ATS sources (default: private/companies.yaml)",
    )
    parser.add_argument(
        "--db",
        type=Path,
        help="write to this SQLite file instead of Supabase (default when Supabase isn't set up: "
        "data/jobs.sqlite)",
    )
    parser.add_argument(
        "--cache", action="store_true", help="cache HTTP responses in .cache/ (development)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="log every request URL (off by default: CI logs are public)",
    )
    parser.add_argument("--only", nargs="*", choices=sorted(SOURCES), help="run these sources")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    # Request URLs would list the private company watchlist in the public Actions log.
    logging.getLogger("httpx").setLevel(logging.INFO if args.verbose else logging.WARNING)
    config = load_config(args.config)
    if args.companies:
        config.setdefault("ats", {})["companies_file"] = str(args.companies.resolve())
    http = config.get("http") or {}
    client = HttpClient(
        user_agent=http.get("user_agent", "job-scout/0.1"),
        delay_seconds=float(http.get("delay_seconds", 1.5)),
        timeout_seconds=float(http.get("timeout_seconds", 30)),
        cache_dir=ROOT / ".cache" / "http" if args.cache else None,
    )
    # Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY are set (CI secrets or .env),
    # unless --db asks for a local SQLite file.
    load_dotenv(ROOT / ".env")
    store = None if args.db else SupabaseStore.from_env()
    if store is None:
        store = Store(args.db or ROOT / "data" / "jobs.sqlite")
    print(f"store: {'supabase' if isinstance(store, SupabaseStore) else store_path(args)}")
    try:
        rules = load_config(args.rules)
        meta = {}
        # The owner's Profile page decides which rules apply. If it can't be read, the run
        # carries on with rules.yaml and says so, instead of failing.
        try:
            prefs = store.load_preferences()
            meta["profile"] = describe(prefs)
        except Exception as exc:
            prefs = None
            meta["profile"] = f"couldn't read the profile ({type(exc).__name__}), using rules.yaml"
        prefilter = Prefilter(apply_profile(rules, prefs))
        # The details go to the private runs table; the public Actions log only says
        # whether a profile was used.
        print("profile: loaded" if prefs else meta["profile"].split(",")[0])

        # Re-apply the current preferences to the stored backlog before collecting.
        if args.only:
            meta["refilter"] = {"skipped": "partial run (--only)"}
        else:
            dropped, restored = refilter(store, prefilter)
            meta["refilter"] = {"dropped": dict(dropped), "restored": restored}
            print(f"backlog re-check | dropped={sum(dropped.values())} restored={restored}")

        stats = collect(
            config, store, client, prefilter, only=args.only, enricher=Enricher(rules), meta=meta
        )
        for line in source_lines(stats):
            print(line)
        print(summary_line(stats, store.count()))
    finally:
        client.close()
        store.close()

    # Fail the run only when every source failed to fetch, so CI flags a real outage.
    all_failed = stats and all(s.fetched == 0 and s.errors for s in stats.values())
    return 1 if all_failed else 0


if __name__ == "__main__":
    sys.exit(main())
