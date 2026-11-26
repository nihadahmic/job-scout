"""Read and write the company watchlist (private/companies.yaml by default)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "private" / "companies.yaml"

HEADER = """\
# Company watchlist for the ATS sources. Private: lives in private/ locally and in the
# job-scout-data repo for CI, never in the public code repo.
# Imported by scripts/import_companies.py; ats/slug filled in by scripts/detect_ats.py.
# Hand edits are kept on re-import and re-detection (set ats_locked: true to pin a value).
"""


def site_key(url: str) -> str:
    """Normalize a website URL for dedupe: no scheme, no www, no trailing slash."""
    url = re.sub(r"^https?://", "", url.strip().lower())
    url = re.sub(r"^www\.", "", url)
    return url.rstrip("/")


def load(path: Path = DEFAULT_PATH) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open() as f:
        data = yaml.safe_load(f) or {}
    return data.get("companies") or []


def save(companies: list[dict[str, Any]], path: Path = DEFAULT_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = yaml.safe_dump({"companies": companies}, sort_keys=False, allow_unicode=True, width=100)
    tmp = path.with_suffix(".yaml.tmp")
    tmp.write_text(HEADER + body)
    tmp.replace(path)  # atomic, so an interrupted run never leaves a half-written file
