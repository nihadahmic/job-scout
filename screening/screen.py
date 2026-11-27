"""Screen new jobs with Gemini: tier, fit, reasons; drop or shortlist. See decisions #015."""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from collector.supabase_store import SupabaseStore, _in
from collector.text import utc_now
from screening.gemini import Gemini, GeminiError, Retryable
from screening.models import RESPONSE_SCHEMA, BatchVerdict, JobVerdict
from screening.prompt import SYSTEM, build_prompt

log = logging.getLogger("screening")

FIELDS = "id,source,status,title,company,location_text,salary_text,description"
# Drop categories that hide a job. A missing "requirement" never hides one: fit is a judgment.
HIDING_DROPS = {"work_permit", "location", "onsite", "industry"}
REQUIREMENT_FIT_CAP = 40


@dataclass
class Settings:
    batch_size: int = 5
    max_per_run: int = 100
    description_chars: int = 4000
    shortlist_max_tier: int = 2
    shortlist_min_fit: int = 60

    @classmethod
    def from_rules(cls, rules: dict[str, Any]) -> Settings:
        s = rules.get("screening") or {}
        return cls(**{k: s[k] for k in cls.__dataclass_fields__ if k in s})


@dataclass
class Stats:
    screened: int = 0
    shortlisted: int = 0
    dropped: int = 0
    errors: int = 0
    tiers: Counter = field(default_factory=Counter)
    stopped: str = ""
    model: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "screened": self.screened,
            "shortlisted": self.shortlisted,
            "dropped": self.dropped,
            "errors": self.errors,
            "tiers": dict(self.tiers),
            "stopped": self.stopped,
            "model": self.model,
        }

    def line(self) -> str:
        tiers = " ".join(f"tier{k}={v}" for k, v in sorted(self.tiers.items()))
        stop = f" | stopped: {self.stopped}" if self.stopped else ""
        return (
            f"screening | screened={self.screened} shortlisted={self.shortlisted} "
            f"dropped={self.dropped} {tiers} errors={self.errors}{stop}"
        )


def candidates(store: SupabaseStore, limit: int) -> list[dict[str, Any]]:
    r = store.client.get(
        "/jobs",
        params={
            "select": FIELDS,
            "status": "eq.new",
            "tier": "is.null",
            "dropped_reason": "is.null",
            # not screened yet, or screening failed last time
            "or": "(screened_at.is.null,screening_error.not.is.null)",
            "order": "first_seen_at.desc",
            "limit": limit,
        },
    )
    r.raise_for_status()
    jobs = r.json()
    # Jobs you saved in Notion ("Ready to Apply"): also when already shortlisted, or
    # rescreened after you pasted a fuller description.
    r = store.client.get(
        "/jobs",
        params={
            "select": FIELDS,
            "source": "eq.notion",
            "status": "in.(new,shortlisted)",
            "tier": "is.null",
            "or": "(screened_at.is.null,screening_error.not.is.null)",
            "limit": limit,
        },
    )
    r.raise_for_status()
    ids = {j["id"] for j in jobs}
    return [j for j in r.json() if j["id"] not in ids] + jobs


def ask(
    gemini: Gemini, jobs: list[dict[str, Any]], experience: str, prefs, settings: Settings
) -> list[JobVerdict]:
    """One batch: call, validate strictly, retry once on a bad answer."""
    prompt = build_prompt(jobs, experience, prefs, settings.description_chars)
    last: Exception | None = None
    for _ in range(2):
        try:
            data = gemini.json(SYSTEM, prompt, RESPONSE_SCHEMA)
            return BatchVerdict.model_validate(data).results
        except Retryable:
            raise
        except (ValidationError, GeminiError) as e:
            last = e
    raise GeminiError(f"invalid answer twice: {str(last)[:150]}")


def apply(
    store: SupabaseStore,
    verdict: JobVerdict,
    model: str,
    settings: Settings,
    stats: Stats,
    job: dict[str, Any] | None = None,
) -> None:
    # You picked it yourself: never hide it, always put it in To apply; fit is information.
    saved = bool(job and job.get("source") == "notion")
    status = (job or {}).get("status", "new")
    now = utc_now()
    patch: dict[str, Any] = {
        "fit": verdict.fit,
        "fit_reason": verdict.fit_reason,
        "eligibility_note": verdict.eligibility_note or None,
        "screened_at": now,
        "screening_model": model,
        "screening_error": None,
    }
    if verdict.tier == "drop" and verdict.drop_category in HIDING_DROPS and not saved:
        reason = verdict.drop_reason or verdict.drop_category.replace("_", " ")
        patch["dropped_reason"] = f"screening:{reason}"[:200]
        stats.dropped += 1
    elif verdict.tier == "drop":
        # A hard requirement he lacks, or no category given: keep it visible, never shortlist.
        patch["fit"] = min(verdict.fit, REQUIREMENT_FIT_CAP)
        note = verdict.drop_reason or "May have a hard requirement you don't meet"
        patch["eligibility_note"] = f"Requirement: {note}"[:300]
        stats.tiers["requirement"] += 1
    else:
        tier = int(verdict.tier)
        patch["tier"] = tier
        stats.tiers[tier] += 1
        if tier <= settings.shortlist_max_tier and verdict.fit >= settings.shortlist_min_fit:
            patch["status"] = "shortlisted"
            patch["status_changed_at"] = now
    if saved and verdict.tier == "drop" and verdict.drop_category in HIDING_DROPS:
        note = verdict.drop_reason or verdict.drop_category.replace("_", " ")
        patch["eligibility_note"] = f"Check: {note}"[:300]
    if saved:
        patch.pop("status", None)
        patch.pop("status_changed_at", None)
        if status == "new":
            patch["status"] = "shortlisted"
            patch["status_changed_at"] = now
    r = store.client.patch(
        "/jobs",
        params={"id": f"eq.{verdict.id}", "status": f"eq.{status}"},
        json=patch,
        headers={"Prefer": "return=representation"},
    )
    r.raise_for_status()
    if r.json() and patch.get("status") == "shortlisted" and status == "new":
        store.client.post(
            "/status_history",
            json={
                "job_id": verdict.id,
                "from_status": "new",
                "to_status": "shortlisted",
                "note": f"Saved in Notion; screening: tier {verdict.tier}, fit {verdict.fit}"
                if saved
                else f"Screening: tier {verdict.tier}, fit {verdict.fit}",
                "changed_at": now,
            },
        ).raise_for_status()
        stats.shortlisted += 1
    stats.screened += 1


def mark_errors(store: SupabaseStore, ids: list[str], message: str, stats: Stats) -> None:
    if not ids:
        return
    store.client.patch(
        "/jobs",
        params={"id": _in(ids)},
        json={"screening_error": message[:300], "screened_at": utc_now()},
    ).raise_for_status()
    stats.errors += len(ids)


def screen(
    store: SupabaseStore, gemini: Gemini, rules: dict[str, Any], dry_run: bool = False
) -> Stats:
    settings = Settings.from_rules(rules)
    stats = Stats()
    r = store.client.get("/profile", params={"select": "preferences,experience", "limit": 1})
    r.raise_for_status()
    profile = (r.json() or [{}])[0]
    jobs = candidates(store, settings.max_per_run)
    for i in range(0, len(jobs), settings.batch_size):
        batch = jobs[i : i + settings.batch_size]
        try:
            verdicts = ask(
                gemini, batch, profile.get("experience") or "", profile.get("preferences"), settings
            )
        except Retryable as e:
            stats.stopped = (
                f"Gemini unavailable or out of quota ({e}); the rest waits for the next run"
            )
            break
        except GeminiError as e:
            if dry_run:
                print(f"  error for {len(batch)} jobs: {str(e)[:200]}")
                stats.errors += len(batch)
            else:
                mark_errors(store, [j["id"] for j in batch], str(e), stats)
            continue
        stats.model = gemini.last_model
        by_id = {v.id: v for v in verdicts}
        missing = [j["id"] for j in batch if j["id"] not in by_id]
        for job in batch:
            v = by_id.get(job["id"])
            if v is None:
                continue
            if dry_run:
                who = f"{job['company'][:22]:22} {job['title'][:45]:45}"
                tag = f"{v.tier}:{v.drop_category}" if v.tier == "drop" else v.tier
                print(f"  {tag:>16} fit {v.fit:>3}  {who} | {v.fit_reason}")
                stats.screened += 1
                continue
            apply(store, v, gemini.last_model, settings, stats, job)
        if missing and not dry_run:
            mark_errors(store, missing, "missing from Gemini's answer", stats)
    return stats


def record(store: SupabaseStore, stats: Stats) -> None:
    """Add the screening counts to today's collector run, so the Runs page shows both."""
    r = store.client.get(
        "/runs", params={"select": "id,summary", "order": "started_at.desc", "limit": 1}
    )
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return
    summary = rows[0]["summary"]
    meta = summary.get("_meta") or {}
    meta["screening"] = stats.as_dict()
    summary["_meta"] = meta
    store.client.patch(
        "/runs", params={"id": f"eq.{rows[0]['id']}"}, json={"summary": summary}
    ).raise_for_status()
