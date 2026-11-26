"""Rule-based prefilter that runs before screening. Rules live in config/rules.yaml.

Stages, in order: title, remote, location, authorization. A job is dropped at the first
stage it fails, and the reason (for example "location:us_only") is counted per source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from collector.models import Job

STAGES = ("title", "remote", "location", "authorization")


def _compile(patterns: list[str]) -> list[re.Pattern[str]]:
    return [re.compile(p, re.IGNORECASE) for p in patterns]


def _any(patterns: list[re.Pattern[str]], text: str) -> bool:
    return any(p.search(text) for p in patterns)


@dataclass(frozen=True)
class Verdict:
    keep: bool
    stage: str | None = None  # first failed stage
    reason: str | None = None  # "<stage>:<detail>"


class Prefilter:
    def __init__(self, rules: dict[str, Any]) -> None:
        t, r, loc, auth = (rules.get(k) or {} for k in STAGES)
        self.title_include = _compile(t.get("include", []))
        self.title_exclude = _compile(t.get("exclude", []))
        self.remote_reject = _compile(r.get("reject", []))
        allow = loc.get("allow", {})
        if isinstance(allow, list):  # flat list: one unnamed group
            allow = {"allowed": allow}
        self.loc_allow_groups = {label: _compile(p) for label, p in allow.items()}
        self.loc_allow = [p for group in self.loc_allow_groups.values() for p in group]
        self.loc_anywhere = _compile(loc.get("anywhere", []))
        self.loc_vague = _compile(loc.get("vague", []))
        self.loc_labels = {
            k: re.compile(v, re.IGNORECASE) for k, v in loc.get("labels", {}).items()
        }
        self.check_description = bool(loc.get("check_description_when_vague", True))
        self.desc_anywhere = _compile(loc.get("description_anywhere", []))
        self.auth_place = _compile(auth.get("requires_place", []))
        self.auth_always = _compile(auth.get("always", []))
        self.auth_ignore = _compile(auth.get("ignore_places", []))

    @classmethod
    def from_file(cls, path: Path) -> Prefilter:
        with path.open() as f:
            return cls(yaml.safe_load(f) or {})

    def check(self, job: Job) -> Verdict:
        for stage in STAGES:
            reason = getattr(self, f"_{stage}")(job)
            if reason:
                return Verdict(False, stage, f"{stage}:{reason}")
        return Verdict(True)

    def location_match(self, job: Job) -> str | None:
        """Why a kept job passed the location stage: an allow label, worldwide or description."""
        text = " | ".join(_location_strings(job))
        for label, patterns in self.loc_allow_groups.items():
            if _any(patterns, text):
                return label
        if _any(self.loc_anywhere, text):
            return "worldwide"
        if self.check_description and _any(self.loc_allow + self.desc_anywhere, job.description):
            return "description"
        return None

    def title_ok(self, title: str) -> bool:
        return self._title(Job("", "", "", "", title, "", True, None, "", None, None)) is None

    # Each stage returns None to pass, or a short reason to drop.

    def _title(self, job: Job) -> str | None:
        if not _any(self.title_include, job.title):
            return "role"
        if _any(self.title_exclude, job.title):
            return "seniority"
        return None

    def _remote(self, job: Job) -> str | None:
        if not job.remote:
            return "not_remote"
        if _any(self.remote_reject, f"{job.title} {job.location_text}"):
            return "hybrid_or_onsite"
        return None

    def _location(self, job: Job) -> str | None:
        # Titles often carry the real restriction ("Product Owner (EU only)"), even when the
        # board's country list says otherwise.
        if not _any(self.loc_allow, job.title):
            for label, pattern in self.loc_labels.items():
                if pattern.search(job.title):
                    return f"{label}_in_title"

        places = _location_strings(job)
        text = " | ".join(places)
        if _any(self.loc_allow, text):
            return None

        specific = text
        for p in self.loc_anywhere + self.loc_vague:
            specific = p.sub(" ", specific)
        specific = re.sub(r"[^\w]+", " ", specific).strip()

        if not specific:
            if _any(self.loc_anywhere, text):
                return None
            if self.check_description and _any(
                self.loc_allow + self.desc_anywhere, job.description
            ):
                return None
            return "unclear"

        for label, pattern in self.loc_labels.items():
            if pattern.search(text):
                return label
        return "other_place"

    def _authorization(self, job: Job) -> str | None:
        text = job.description
        if _any(self.auth_always, text):
            return "permit_required"
        for pattern in self.auth_place:
            for match in pattern.finditer(text):
                place = match.group("place")
                if _any(self.auth_ignore, place):
                    continue
                if not _any(self.loc_allow + self.loc_anywhere, place):
                    return "permit_required"
        return None


def _location_strings(job: Job) -> list[str]:
    """Location text plus any structured country list a source provides."""
    places = [job.location_text or ""]
    restrictions = job.extra.get("location_restrictions")
    if isinstance(restrictions, list):
        places.extend(str(x) for x in restrictions)
    return places
