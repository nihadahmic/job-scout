"""Import the Remoteur CSV into the company watchlist.

Usage: uv run python -m scripts.import_companies [CSV] [--out private/companies.yaml]

The CSV has a banner on row 1 and the header (Company, About, HQ, Website) on row 2.
Rows are deduplicated by website. Existing entries keep their detected ATS fields.
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from scripts.companies_file import DEFAULT_PATH, ROOT, load, save, site_key

DEFAULT_CSV = ROOT / "private" / "remote_companies_europe.csv"
EXPECTED_HEADER = ["Company", "About", "HQ", "Website"]


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f))
    header_index = next(
        (i for i, r in enumerate(rows[:5]) if [c.strip() for c in r[:4]] == EXPECTED_HEADER), None
    )
    if header_index is None:
        raise SystemExit(f"header {EXPECTED_HEADER} not found in the first 5 rows of {path}")
    out = []
    for r in rows[header_index + 1 :]:
        r = [c.strip() for c in r] + [""] * (4 - len(r))
        name, about, hq, website = r[:4]
        if name and website:
            out.append({"name": name, "about": about, "hq": hq, "website": website})
    return out


def merge(existing: list[dict], incoming: list[dict]) -> tuple[list[dict], dict[str, int]]:
    by_site = {site_key(c["website"]): c for c in existing}
    counts = {"added": 0, "updated": 0, "duplicate_in_csv": 0}
    seen: set[str] = set()
    for row in incoming:
        key = site_key(row["website"])
        if key in seen:
            counts["duplicate_in_csv"] += 1
            continue
        seen.add(key)
        if key in by_site:
            by_site[key].update(row)  # refresh name/about/hq, keep ats fields
            counts["updated"] += 1
        else:
            by_site[key] = dict(row)
            counts["added"] += 1
    companies = sorted(by_site.values(), key=lambda c: c["name"].lower())
    return companies, counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, nargs="?", default=DEFAULT_CSV)
    parser.add_argument("--out", type=Path, default=DEFAULT_PATH)
    args = parser.parse_args(argv)

    incoming = read_csv(args.csv)
    companies, counts = merge(load(args.out), incoming)
    save(companies, args.out)
    print(
        f"import | csv_rows={len(incoming)} added={counts['added']} updated={counts['updated']} "
        f"duplicate_in_csv={counts['duplicate_in_csv']} total={len(companies)} -> {args.out}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
