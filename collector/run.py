"""One collector run: fetch each enabled source, normalize, prefilter, dedupe, store, summarize."""

from __future__ import annotations

import logging
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from collector.enrich import Enricher
from collector.http import Fetcher
from collector.prefilter import STAGES, Prefilter
from collector.sources import ATS_SOURCES, SOURCES
from collector.store import Store
from collector.text import utc_now

log = logging.getLogger("collector")


@dataclass
class SourceStats:
    fetched: int = 0
    normalized: int = 0
    # jobs still in after each prefilter stage, keyed by stage name
    passed: dict[str, int] = field(default_factory=lambda: dict.fromkeys(STAGES, 0))
    dropped: Counter = field(default_factory=Counter)
    new: int = 0
    known: int = 0
    duplicate: int = 0
    errors: int = 0
    error_messages: list[str] = field(default_factory=list)

    def add(self, other: SourceStats) -> None:
        for attr in ("fetched", "normalized", "new", "known", "duplicate", "errors"):
            setattr(self, attr, getattr(self, attr) + getattr(other, attr))
        for stage in STAGES:
            self.passed[stage] += other.passed[stage]
        self.dropped.update(other.dropped)

    def as_dict(self) -> dict[str, Any]:
        return {
            "fetched": self.fetched,
            "normalized": self.normalized,
            "passed": dict(self.passed),
            "dropped": dict(sorted(self.dropped.items())),
            "new": self.new,
            "known": self.known,
            "duplicate": self.duplicate,
            "errors": self.errors,
            "error_messages": self.error_messages[:5],
        }


def load_config(path: Path) -> dict[str, Any]:
    with path.open() as f:
        return yaml.safe_load(f) or {}


def collect(
    config: dict[str, Any],
    store: Store,
    client: Fetcher,
    prefilter: Prefilter,
    only: list[str] | None = None,
    now: Callable[[], str] = utc_now,
    enricher: Enricher | None = None,
) -> dict[str, SourceStats]:
    started_at = now()
    stats: dict[str, SourceStats] = {}

    for name, source_cls in SOURCES.items():
        if name not in config or (only and name not in only):
            continue  # a source runs only when config/sources.yaml has an entry for it
        source_config = config.get(name) or {}
        if not source_config.get("enabled", True):
            continue
        if source_cls in ATS_SOURCES:
            # Shared ATS settings (watchlist path) plus the title check, so sources that
            # need a request per job can skip obvious non-matches first.
            source_config = {**(config.get("ats") or {}), **source_config}
            source_config["_title_ok"] = getattr(prefilter, "title_ok", None)
        s = stats[name] = SourceStats()
        source = source_cls(client, source_config)
        try:
            raws = source.fetch()
        except Exception as exc:  # one broken source must not stop the others
            s.errors += 1
            s.error_messages.append(f"fetch: {type(exc).__name__}: {exc}")
            log.warning("%s fetch failed: %s", name, exc)
            continue
        s.fetched = len(raws)
        s.error_messages.extend(getattr(source, "errors", []))
        s.errors += len(getattr(source, "errors", []))

        kept = []
        for raw in raws:
            try:
                job = source.normalize(raw)
            except Exception as exc:
                s.errors += 1
                s.error_messages.append(f"normalize {raw.source_id}: {type(exc).__name__}: {exc}")
                continue
            s.normalized += 1

            verdict = prefilter.check(job)
            for stage in STAGES:
                if stage == verdict.stage:
                    break
                s.passed[stage] += 1
            if not verdict.keep:
                s.dropped[verdict.reason] += 1
                continue
            kept.append(_enrich(job, prefilter, enricher))

        for outcome in store.add_many(kept, seen_at=started_at):
            setattr(s, outcome, getattr(s, outcome) + 1)

    store.record_run(started_at, now(), {k: v.as_dict() for k, v in stats.items()})
    store.commit()
    return stats


def _enrich(job, prefilter, enricher: Enricher | None):
    location_match = getattr(prefilter, "location_match", None)
    if location_match:
        job.location_match = location_match(job)
    if enricher:
        job.category = enricher.category(job.title)
        salary = enricher.salary(job.salary_text)
        if salary:
            job.salary_min_eur_month = salary.min_eur_month
            job.salary_max_eur_month = salary.max_eur_month
    return job


def _counts(s: SourceStats) -> str:
    stages = " ".join(f"{stage}={s.passed[stage]}" for stage in STAGES)
    return (
        f"fetched={s.fetched} {stages} new={s.new} known={s.known} "
        f"dup={s.duplicate} errors={s.errors}"
    )


def source_lines(stats: dict[str, SourceStats]) -> list[str]:
    """One detail line per source: counts after each stage, then drops by reason."""
    lines = []
    for name, s in stats.items():
        reasons = ", ".join(f"{r}={n}" for r, n in s.dropped.most_common()) or "none"
        lines.append(f"{name}: {_counts(s)} | dropped: {reasons}")
    return lines


def summary_line(stats: dict[str, SourceStats], total_in_db: int) -> str:
    total = SourceStats()
    for s in stats.values():
        total.add(s)
    parts = [f"{name} {_counts(s)}" for name, s in stats.items()]
    parts.append(f"total {_counts(total)} in_db={total_in_db}")
    return "collector | " + " | ".join(parts)
