"""Notion stages -> app statuses. Shared by the daily sync and scripts/import_notion.py."""

from __future__ import annotations

SAVED_STAGES = {"Ready to Apply"}
REPLY_STAGES = {"Interview", "Screening", "Reached Out to Me"}

# Forward order of the active statuses; a sync only ever moves a job up this list,
# or closes it. A job you closed in the app is never reopened from Notion.
RANK = {"new": 0, "shortlisted": 1, "in_progress": 2, "applied": 3, "interviewing": 4, "offer": 5}
CLOSED = {"skipped", "withdrawn", "not_moving_forward", "accepted", "declined"}


def _clean(stages: list[str]) -> set[str]:
    return {" ".join(s.split()) for s in stages if s and s.strip()}


def is_saved(stages: list[str]) -> bool:
    """No stage yet, or only "Ready to Apply": a job you saved but haven't applied to."""
    return _clean(stages) <= SAVED_STAGES


def final_status(stages: list[str]) -> str:
    s = _clean(stages)
    if not s - SAVED_STAGES:
        return "new"
    if "Signed ✍️" in s or "Signed" in s:
        return "accepted"
    if "Won't be moving forward" in s:
        return "not_moving_forward"
    if "Offered 😃" in s or "Offered" in s:
        return "offer"
    if s & REPLY_STAGES:
        return "interviewing"
    return "applied"


def reached_interview(stages: list[str]) -> bool:
    return bool(_clean(stages) & REPLY_STAGES)


def steps(current: str, target: str, stages: list[str]) -> list[str]:
    """Statuses to pass through to get from `current` to `target`, or [] to stay put.

    A job that wasn't applied to yet passes through "applied" (and "interviewing" when
    the stages show one) so Insights counts the application and the reply."""
    if current in CLOSED or target == current or target == "new":
        return []
    if target not in CLOSED and RANK.get(target, -1) <= RANK.get(current, -1):
        return []
    path: list[str] = []
    if RANK.get(current, 0) < RANK["applied"] and target != "applied":
        path.append("applied")
    if (
        reached_interview(stages)
        and RANK.get(current, 0) < RANK["interviewing"]
        and target not in {"interviewing", "applied"}
    ):
        path.append("interviewing")
    return [*path, target]


def close_reason(target: str, passed_interview: bool) -> str | None:
    if target != "not_moving_forward":
        return None
    return "Rejected after interview" if passed_interview else "Rejected after applying"
