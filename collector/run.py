"""One collector run: fetch every enabled source, normalize, dedupe, store, summarize."""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from collector.http import Fetcher
from collector.sources import SOURCES
from collector.store import Store
from collector.text import utc_now

log = logging.getLogger("collector")


@dataclass
class SourceStats:
    fetched: int = 0
    new: int = 0
    known: int = 0
    duplicate: int = 0
    errors: int = 0
    error_messages: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "fetched": self.fetched,
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
    only: list[str] | None = None,
    now: Callable[[], str] = utc_now,
) -> dict[str, SourceStats]:
    started_at = now()
    stats: dict[str, SourceStats] = {}

    for name, source_cls in SOURCES.items():
        source_config = config.get(name) or {}
        if only and name not in only:
            continue
        if not source_config.get("enabled", True):
            continue
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
        for raw in raws:
            try:
                job = source.normalize(raw)
            except Exception as exc:
                s.errors += 1
                s.error_messages.append(f"normalize {raw.source_id}: {type(exc).__name__}: {exc}")
                continue
            outcome = store.add(job, seen_at=started_at)
            setattr(s, outcome, getattr(s, outcome) + 1)

    store.record_run(started_at, now(), {k: v.as_dict() for k, v in stats.items()})
    store.commit()
    return stats


def _counts(s: SourceStats) -> str:
    return f"fetched={s.fetched} new={s.new} known={s.known} dup={s.duplicate} errors={s.errors}"


def summary_line(stats: dict[str, SourceStats], total_in_db: int) -> str:
    total = SourceStats()
    for s in stats.values():
        for attr in ("fetched", "new", "known", "duplicate", "errors"):
            setattr(total, attr, getattr(total, attr) + getattr(s, attr))
    parts = [f"{name} {_counts(s)}" for name, s in stats.items()]
    parts.append(f"total {_counts(total)} in_db={total_in_db}")
    return "collector | " + " | ".join(parts)
