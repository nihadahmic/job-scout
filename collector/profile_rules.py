"""Turn the owner's profile preferences into prefilter rules for one run.

config/rules.yaml holds the patterns (how "EMEA" or "Staff" is spotted). The profile, edited
on the app's Profile page, decides which of them apply. Without a profile, rules.yaml is
used as it is. Pure functions: no network, easy to test.
"""

from __future__ import annotations

import copy
from typing import Any

CORE_LOCATIONS = ("balkans", "europe", "cet")


def apply_profile(rules: dict[str, Any], prefs: dict[str, Any] | None) -> dict[str, Any]:
    """Return a copy of `rules` adjusted to `prefs` (the profile's preferences JSON)."""
    out = copy.deepcopy(rules)
    if not prefs:
        return out
    title = out.setdefault("title", {})
    remote = out.setdefault("remote", {})
    loc = out.setdefault("location", {})

    categories = rules.get("categories") or {}
    chosen = [c for c in prefs.get("categories") or [] if c in categories]
    if chosen:
        title["include"] = [categories[c] for c in chosen]

    seniority = rules.get("seniority") or {}
    if "exclude_seniority" in prefs:
        title["exclude_levels"] = [lv for lv in prefs["exclude_seniority"] if lv in seniority]
        title.pop("exclude", None)

    work = prefs.get("work") or {}
    remote["allow_local"] = bool(work.get("sarajevo_hybrid", False))
    remote["require_local"] = work.get("remote") is False

    places = prefs.get("locations") or {}
    allow = dict(loc.get("allow") or {})
    for group in CORE_LOCATIONS:
        if places.get(group) is False:
            allow.pop(group, None)
    loc["allow"] = allow
    loc["allow_anywhere"] = places.get("worldwide") is not False
    optional = loc.get("optional") or {}
    loc["enable_optional"] = [name for name in optional if places.get(name)]
    loc["keep_unclear"] = bool(places.get("plain_remote", False))

    out["company"] = {"skip": [c for c in prefs.get("skip_companies") or [] if str(c).strip()]}
    return out


def describe(prefs: dict[str, Any] | None) -> str:
    """One line for the run log: what the profile changed."""
    if not prefs:
        return "no profile, using rules.yaml"
    places = prefs.get("locations") or {}
    on = [k for k, v in places.items() if v]
    return (
        f"profile: {len(prefs.get('categories') or [])} categories, "
        f"{len(prefs.get('exclude_seniority') or [])} seniority levels skipped, "
        f"locations {'+'.join(on) or 'none'}, "
        f"{len(prefs.get('skip_companies') or [])} companies skipped"
    )
