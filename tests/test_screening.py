"""Screening with a fake Gemini and a fake Supabase (no network)."""

import json
import re
from urllib.parse import parse_qs

import httpx
import pytest
from pydantic import ValidationError

from collector.supabase_store import SupabaseStore
from screening.gemini import Gemini
from screening.models import JobVerdict
from screening.prompt import build_prompt
from screening.screen import Settings, record, screen

RULES = {
    "screening": {
        "batch_size": 5,
        "max_per_run": 10,
        "shortlist_max_tier": 2,
        "shortlist_min_fit": 60,
    }
}
PREFS = {
    "categories": ["product_manager"],
    "primary_category": "product_manager",
    "work": {"contract": True, "employment": True, "sarajevo_hybrid": True},
    "salary": {"floor_eur_hour": 30, "target_eur_hour": 50},
}


class FakeDb:
    def __init__(self, jobs):
        self.jobs = {
            j["id"]: {"status": "new", "tier": None, "dropped_reason": None, **j} for j in jobs
        }
        self.history, self.runs = [], [{"id": 1, "summary": {"ashby": {"new": 3}}}]

    def __call__(self, req: httpx.Request) -> httpx.Response:
        table = req.url.path.rsplit("/", 1)[-1]
        q = {k: v[0] for k, v in parse_qs(req.url.query.decode()).items()}
        body = json.loads(req.content) if req.content else None
        if table == "profile":
            return httpx.Response(
                200,
                json=[{"preferences": PREFS, "experience": "Led onboarding at a health platform."}],
            )
        if table == "runs":
            if req.method == "GET":
                return httpx.Response(200, json=self.runs)
            self.runs[0].update(body)
            return httpx.Response(204)
        if table == "status_history":
            self.history.append(body)
            return httpx.Response(201)
        if req.method == "GET":
            rows = [
                j
                for j in self.jobs.values()
                if j["status"] == "new" and j["tier"] is None and j["dropped_reason"] is None
            ]
            return httpx.Response(200, json=rows[: int(q.get("limit", 100))])
        ids = re.findall(r'"([^"]+)"', q["id"]) if q["id"].startswith("in.") else [q["id"][3:]]
        changed = []
        for i in ids:
            row = self.jobs[i]
            if q.get("status") == "eq.new" and row["status"] != "new":
                continue
            row.update(body)
            changed.append(row)
        return httpx.Response(200, json=changed)


def gemini_returning(*answers):
    """A fake Gemini that returns the given JSON answers (or status codes) in order."""
    queue = list(answers)

    def handler(req):
        a = queue.pop(0)
        if isinstance(a, int):
            return httpx.Response(a, json={"error": {"message": "busy"}})
        return httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(a)}]}}]}
        )

    g = Gemini("test-key", transport=httpx.MockTransport(handler))
    g.backoff = ()  # no waiting in tests
    return g


def job(i, title="Senior Product Manager"):
    return {
        "id": f"ashby:acme/{i}",
        "title": title,
        "company": "Acme",
        "location_text": "Remote, Europe",
        "salary_text": None,
        "description": "We build things.",
    }


def verdict(i, tier, fit, **kw):
    return {
        "id": f"ashby:acme/{i}",
        "tier": tier,
        "fit": fit,
        "fit_reason": "Strong onboarding match.",
        "eligibility_note": kw.get("note", ""),
        "drop_reason": kw.get("drop", ""),
        "drop_category": kw.get("category", ""),
    }


@pytest.fixture
def db():
    return FakeDb([job(1), job(2), job(3)])


@pytest.fixture
def store(db):
    return SupabaseStore("https://p.supabase.co", "sb_secret_x", transport=httpx.MockTransport(db))


def test_shortlist_drop_and_keep(db, store):
    g = gemini_returning(
        {
            "results": [
                verdict(1, "1", 82),
                verdict(2, "drop", 30, drop="Requires EU work permit", category="work_permit"),
                verdict(3, "3", 75),
            ]
        }
    )
    stats = screen(store, g, RULES)
    j1, j2, j3 = (db.jobs[f"ashby:acme/{i}"] for i in (1, 2, 3))
    assert j1["status"] == "shortlisted" and j1["tier"] == 1 and j1["fit"] == 82
    assert db.history == [
        {
            "job_id": "ashby:acme/1",
            "from_status": "new",
            "to_status": "shortlisted",
            "note": "Screening: tier 1, fit 82",
            "changed_at": j1["screened_at"],
        }
    ]
    assert j2["dropped_reason"] == "screening:Requires EU work permit" and j2["status"] == "new"
    assert (
        j3["status"] == "new" and j3["tier"] == 3
    )  # tier 3 is never shortlisted, whatever the fit
    assert (stats.screened, stats.shortlisted, stats.dropped) == (3, 1, 1)
    assert j1["screening_model"] == "gemini-3.5-flash-lite"


def test_low_fit_tier_one_stays_new(db, store):
    screen(store, gemini_returning({"results": [verdict(i, "1", 55) for i in (1, 2, 3)]}), RULES)
    assert all(j["status"] == "new" and j["tier"] == 1 for j in db.jobs.values())


def test_invalid_answer_retried_once_then_marked(db, store):
    bad = {"results": [{"id": "ashby:acme/1", "tier": "5", "fit": 200}]}
    stats = screen(store, gemini_returning(bad, bad), RULES)
    assert stats.errors == 3
    assert all(j["screening_error"].startswith("invalid answer twice") for j in db.jobs.values())
    assert all(j["tier"] is None and j["status"] == "new" for j in db.jobs.values())


def test_missing_job_is_marked(db, store):
    stats = screen(
        store, gemini_returning({"results": [verdict(1, "2", 70), verdict(2, "2", 70)]}), RULES
    )
    assert (
        stats.errors == 1
        and db.jobs["ashby:acme/3"]["screening_error"] == "missing from Gemini's answer"
    )


def test_busy_model_is_retried_before_giving_up(db, store):
    g = gemini_returning(503, 503, {"results": [verdict(i, "2", 70) for i in (1, 2, 3)]})
    g.backoff = (0, 0)
    assert screen(store, g, RULES).screened == 3


def test_quota_stops_the_run_and_leaves_jobs_for_tomorrow(db, store):
    stats = screen(store, gemini_returning(429), RULES)
    assert stats.stopped.startswith("Gemini unavailable or out of quota")
    assert all(j["tier"] is None and j.get("screening_error") is None for j in db.jobs.values())


def test_preferred_model_falls_back_to_flash_lite(db, store):
    g = gemini_returning(503, {"results": [verdict(i, "2", 65) for i in (1, 2, 3)]})
    g.models = ["gemini-3.6-flash", "gemini-3.5-flash-lite"]
    stats = screen(store, g, RULES)
    assert stats.model == "gemini-3.5-flash-lite" and stats.shortlisted == 3


def test_record_adds_counts_to_latest_run(db, store):
    stats = screen(
        store, gemini_returning({"results": [verdict(i, "1", 90) for i in (1, 2, 3)]}), RULES
    )
    record(store, stats)
    assert db.runs[0]["summary"]["_meta"]["screening"]["shortlisted"] == 3
    assert db.runs[0]["summary"]["ashby"] == {"new": 3}


def test_verdict_validation():
    assert JobVerdict.model_validate({**verdict(1, 1, 50)}).tier == "1"
    assert (
        JobVerdict.model_validate(
            {**verdict(1, "2", 50), "fit_reason": "Good fit — some gaps"}
        ).fit_reason
        == "Good fit , some gaps"
    )
    with pytest.raises(ValidationError):
        JobVerdict.model_validate(verdict(1, "4", 50))
    with pytest.raises(ValidationError):
        JobVerdict.model_validate(verdict(1, "1", 101))


def test_prompt_has_no_salary_numbers_or_contact_details():
    text = build_prompt([job(1)], "Led onboarding.", PREFS, 4000)
    assert "ashby:acme/1" in text and "Led onboarding." in text
    assert "30" not in text and "50" not in text and "salary_floor" not in text


def test_settings_from_rules():
    assert Settings.from_rules(RULES).max_per_run == 10
    assert Settings.from_rules({}).shortlist_min_fit == 60


def test_requirement_drops_stay_visible_with_capped_fit(db, store):
    g = gemini_returning(
        {
            "results": [
                verdict(
                    1,
                    "drop",
                    55,
                    drop="Needs top-tier consulting background",
                    category="requirement",
                ),
                verdict(2, "drop", 50, drop="iGaming company", category="industry"),
                verdict(3, "drop", 70),  # no category: treated like a requirement, never hidden
            ]
        }
    )
    stats = screen(store, g, RULES)
    j1, j2, j3 = (db.jobs[f"ashby:acme/{i}"] for i in (1, 2, 3))
    assert j1["dropped_reason"] is None and j1["fit"] == 40 and j1["status"] == "new"
    assert j1["eligibility_note"] == "Requirement: Needs top-tier consulting background"
    assert j2["dropped_reason"] == "screening:iGaming company"
    assert j3["dropped_reason"] is None and j3["fit"] == 40
    assert stats.dropped == 1 and stats.tiers["requirement"] == 2
