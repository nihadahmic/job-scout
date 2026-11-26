"""Build the screening prompt. Sends job text, the anonymized experience and a summary of
the owner's preferences. Never the CV, application facts or salary numbers."""

from __future__ import annotations

from typing import Any

SYSTEM = """You screen remote job postings for one candidate: a senior product manager based in
Sarajevo, Bosnia and Herzegovina (CET). For each job, judge eligibility and fit from the posting
text only. Do not guess eligibility the posting does not support; when it says nothing, use tier 3.

Tiers:
- "1": based in Bosnia and Herzegovina (any workplace type), or remote and explicitly open to
  Bosnia, or worldwide / anywhere.
- "2": remote and open to Serbia, Croatia, Slovenia, Montenegro, North Macedonia, the Balkans,
  CEE, or EMEA/Europe, with no EU work-permit requirement.
- "3": remote, eligibility unclear.
- "drop": only for these reasons: requires EU/UK/US work authorization or residence in one
  specific country; hybrid or on-site outside Bosnia; the company is in betting, gambling,
  iGaming, alcohol, tobacco, cannabis or drugs; or a hard requirement he clearly cannot meet
  (for example a language he does not speak, or a required licence).
  Never drop because the fit is weak or the domain is different: give a low fit instead.

Fit (0-100): how well his experience matches what the role needs (domain, level, skills).
Be honest; most jobs are 40-75. Name the main gap in the reason when there is one.
fit_reason: one sentence, at most 25 words. eligibility_note: at most 20 words, quote the
posting's location or hiring wording when it decides the tier. drop_reason: empty unless tier
is "drop". drop_category: "none" unless tier is "drop"; then one of work_permit, location,
onsite, industry, requirement. Never use em dashes."""


def preferences_summary(prefs: dict[str, Any] | None) -> str:
    if not prefs:
        return (
            "Targets product manager, product owner, business analyst, project manager and "
            "implementation roles."
        )
    names = {
        "product_manager": "Product Manager",
        "product_owner": "Product Owner",
        "business_analyst": "Business Analyst",
        "project_manager": "Project Manager",
        "implementation": "Implementation",
    }
    cats = ", ".join(names.get(c, c) for c in prefs.get("categories") or [])
    work = prefs.get("work") or {}
    kinds = [
        k
        for k, on in (
            ("contract/B2B", work.get("contract")),
            ("employment", work.get("employment")),
        )
        if on
    ]
    primary = names.get(prefs.get("primary_category", ""), "Product Manager")
    lines = [f"Target roles: {cats or 'product roles'} (primary: {primary})."]
    if kinds:
        lines.append(f"Open to: {' and '.join(kinds)}.")
    if work.get("sarajevo_hybrid"):
        lines.append("Hybrid or on-site work in Sarajevo is fine.")
    return " ".join(lines)


def build_prompt(
    jobs: list[dict[str, Any]], experience: str, prefs: dict[str, Any] | None, chars: int
) -> str:
    parts = [
        f"CANDIDATE PREFERENCES: {preferences_summary(prefs)}",
        f"CANDIDATE EXPERIENCE (anonymized):\n{experience or '(not provided)'}",
        "JOBS:",
    ]
    for j in jobs:
        parts.append(
            "\n".join(
                [
                    f"[id: {j['id']}]",
                    f"Title: {j['title']}",
                    f"Company: {j['company']}",
                    f"Location: {j.get('location_text') or 'not stated'}",
                    f"Salary in posting: {j.get('salary_text') or 'not stated'}",
                    f"Posting:\n{(j.get('description') or '(no description)')[:chars]}",
                ]
            )
        )
    parts.append("Return one result per job, using each job's id exactly as given.")
    return "\n\n---\n\n".join(parts)
