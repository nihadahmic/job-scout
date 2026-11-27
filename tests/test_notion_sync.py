"""Notion sync against fake Notion and Supabase APIs (no network)."""

import json
from urllib.parse import parse_qs

import httpx
import pytest

from collector.enrich import Enricher
from collector.supabase_store import SupabaseStore
from notion_sync.notion import Notion
from notion_sync.parse import linkedin_job_id, split_role
from notion_sync.stages import final_status, is_saved, steps
from notion_sync.sync import NotionSync

RULES = {"categories": {}, "salary": {}}


# --- stages and parsing -------------------------------------------------------------------
def test_stages():
    assert is_saved([]) and is_saved(["Ready to Apply"]) and not is_saved(["Applied 🙂"])
    assert final_status(["Ready to Apply"]) == "new"
    assert final_status(["Applied 🙂"]) == "applied"
    assert final_status(["Applied 🙂", "Interview"]) == "interviewing"
    assert final_status(["Applied 🙂", "Won't be moving forward"]) == "not_moving_forward"
    assert final_status(["Referred  😇"]) == "applied"  # double space in your option name


def test_steps_only_go_forward():
    assert steps("new", "applied", ["Applied 🙂"]) == ["applied"]
    assert steps("shortlisted", "interviewing", ["Interview"]) == ["applied", "interviewing"]
    assert steps("new", "not_moving_forward", ["Interview", "Won't be moving forward"]) == [
        "applied",
        "interviewing",
        "not_moving_forward",
    ]
    assert steps("interviewing", "applied", ["Applied 🙂"]) == []  # never backwards
    assert steps("withdrawn", "interviewing", ["Interview"]) == []  # closed in the app stays
    assert steps("applied", "not_moving_forward", ["Won't be moving forward"]) == [
        "not_moving_forward"
    ]


@pytest.mark.parametrize(
    ("raw", "positions", "expected"),
    [
        ("Paddle (Product Marketing Manager)", [], ("Product Marketing Manager", "Paddle")),
        (
            "Project Manager - Software Development (Fintech) at Zact Inc.",
            [],
            ("Project Manager - Software Development (Fintech)", "Zact Inc."),
        ),
        ("Senior Product Manager | Acme | LinkedIn", [], ("Senior Product Manager", "Acme")),
        (
            "(2) Acme hiring Product Lead in Berlin, Germany | LinkedIn",
            [],
            ("Product Lead", "Acme"),
        ),
        ("Wolt", ["Product Lead"], ("Product Lead", "Wolt")),
        ("Just a title", [], ("Just a title", None)),
    ],
)
def test_split_role(raw, positions, expected):
    assert split_role(raw, positions) == expected


def test_linkedin_ids():
    assert linkedin_job_id("https://www.linkedin.com/jobs/view/4012345678/?trk=x") == "4012345678"
    assert linkedin_job_id("https://www.linkedin.com/jobs/view/senior-pm-at-acme-4012345678") == (
        "4012345678"
    )
    assert linkedin_job_id("https://www.linkedin.com/jobs/search/?currentJobId=4012345678") == (
        "4012345678"
    )
    assert linkedin_job_id("https://jobs.ashbyhq.com/acme/123") is None


# --- fakes --------------------------------------------------------------------------------
def page(pid, role, stages=(), created="2026-11-20T10:00:00.000Z", edited=None, **props):
    p = {
        "Role": {"type": "title", "title": [{"plain_text": role}]},
        "Stage": {"type": "multi_select", "multi_select": [{"name": s} for s in stages]},
        "Position": {"type": "multi_select", "multi_select": []},
        "Posting URL": {"type": "url", "url": props.get("url")},
        "Linkedin Job Post": {"type": "url", "url": props.get("linkedin")},
        "Salary Range": {"type": "rich_text", "rich_text": []},
        "Notes (Reason, etc.)": {
            "type": "rich_text",
            "rich_text": [{"plain_text": props["notes"]}] if props.get("notes") else [],
        },
    }
    return {
        "id": pid,
        "created_time": created,
        "last_edited_time": edited or created,
        "properties": p,
    }


class Fake:
    """Notion and PostgREST in one transport."""

    def __init__(self, jobs=(), pages=(), body="We build things for teams."):
        self.jobs = {j["id"]: {"description": "", "apply_url": None, **j} for j in jobs}
        self.pages = list(pages)
        self.body = body
        self.notion_pages, self.history, self.notes = {}, [], []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path = req.url.path
        q = {k: v[0] for k, v in parse_qs(req.url.query.decode()).items()}
        body = json.loads(req.content) if req.content else None
        if path.startswith("/v1/data_sources/"):
            return httpx.Response(200, json={"results": self.pages, "has_more": False})
        if path.startswith("/v1/blocks/"):
            block = {"type": "paragraph", "paragraph": {"rich_text": [{"plain_text": self.body}]}}
            return httpx.Response(200, json={"results": [block], "has_more": False})
        table = path.rsplit("/", 1)[-1]
        if table == "jobs" and req.method == "GET":
            cols = q["select"].split(",")
            rows = [{c: j.get(c) for c in cols} for j in self.jobs.values()]
            return httpx.Response(200, json=rows[int(q.get("offset", 0)) :])
        if table == "notion_pages" and req.method == "GET":
            return httpx.Response(200, json=list(self.notion_pages.values()))
        if table == "notion_pages":
            self.notion_pages.setdefault(body["page_id"], {}).update(body)
            return httpx.Response(201)
        if table == "jobs" and req.method == "POST":
            self.jobs[body["id"]] = dict(body)
            return httpx.Response(201)
        if table == "jobs" and req.method == "PATCH":
            job = self.jobs.get(q["id"][3:])
            if not job or ("status" in q and job["status"] != q["status"][3:]):
                return httpx.Response(200, json=[])
            job.update(body)
            return httpx.Response(200, json=[job])
        if table == "status_history":
            self.history += body if isinstance(body, list) else [body]
            return httpx.Response(201)
        if table == "job_notes":
            self.notes.append(body)
            return httpx.Response(201)
        return httpx.Response(404)


def run(fake):
    t = httpx.MockTransport(fake)
    store = SupabaseStore("https://p.supabase.co", "sb_secret_x", transport=t)
    notion = Notion("secret_x", transport=t)
    return NotionSync(store, notion, Enricher(RULES)).run("ds", since=None)


def existing(jid, status="new", **kw):
    return {
        "id": jid,
        "source": "ashby",
        "status": status,
        "url": "https://jobs.ashbyhq.com/acme/1",
        "dedupe_key": "acme|senior product manager",
        "title": "Senior Product Manager",
        "company": "Acme",
        **kw,
    }


# --- sync ---------------------------------------------------------------------------------
def test_saved_page_becomes_a_backlog_job_with_its_description():
    fake = Fake(
        pages=[
            page(
                "aaaa-1",
                "Senior PM | Lumen | LinkedIn",
                ["Ready to Apply"],
                linkedin="https://www.linkedin.com/jobs/view/4011111111/",
            )
        ]
    )
    stats = run(fake)
    job = fake.jobs["notion:aaaa1"]
    assert job["status"] == "new" and job["source"] == "notion"  # screening shortlists it
    assert job["company"] == "Lumen" and job["description"] == "We build things for teams."
    assert job["url"] == "https://www.linkedin.com/jobs/view/4011111111/"
    assert stats.counts["new_saved"] == 1 and fake.history == []


def test_applied_page_is_tracked_from_its_creation_date():
    fake = Fake(pages=[page("b1", "Wolt (Product Lead)", ["Applied 🙂"], notes="Easy Apply")])
    run(fake)
    job = fake.jobs["notion:b1"]
    assert job["status"] == "applied" and job["applied_at"] == "2026-11-20T10:00:00.000Z"
    assert [h["to_status"] for h in fake.history] == ["applied"]
    assert fake.notes[0]["body"] == "Easy Apply"
    assert job["description"] == ""  # no need to fetch the body for applied jobs


def test_saved_page_matching_a_board_job_shortlists_it_instead_of_copying():
    fake = Fake(
        jobs=[existing("ashby:acme/1", dropped_reason="title:seniority")],
        pages=[page("c1", "Acme (Senior Product Manager)", ["Ready to Apply"])],
    )
    stats = run(fake)
    assert "notion:c1" not in fake.jobs and stats.counts["matched"] == 1
    j = fake.jobs["ashby:acme/1"]
    assert j["status"] == "shortlisted" and j["dropped_reason"] is None
    assert fake.notion_pages["c1"]["job_id"] == "ashby:acme/1"


def test_stage_change_moves_forward_and_closes_with_reason():
    fake = Fake(pages=[page("d1", "Acme (Senior Product Manager)", ["Ready to Apply"])])
    run(fake)
    fake.pages = [
        page(
            "d1",
            "Acme (Senior Product Manager)",
            ["Applied 🙂", "Interview"],
            edited="2026-11-25T09:00:00.000Z",
        )
    ]
    run(fake)
    assert fake.jobs["notion:d1"]["status"] == "interviewing"
    fake.pages = [
        page(
            "d1",
            "Acme (Senior Product Manager)",
            ["Applied 🙂", "Interview", "Won't be moving forward"],
            edited="2026-11-27T09:00:00.000Z",
        )
    ]
    run(fake)
    j = fake.jobs["notion:d1"]
    assert j["status"] == "not_moving_forward" and j["close_reason"] == "Rejected after interview"
    assert [h["to_status"] for h in fake.history] == [
        "applied",
        "interviewing",
        "not_moving_forward",
    ]


def test_already_imported_pages_are_left_alone_and_app_closures_win():
    fake = Fake(
        jobs=[
            {**existing("notion:e1", "not_moving_forward"), "source": "notion"},
            {**existing("notion:e2", "withdrawn"), "source": "notion", "dedupe_key": "x|y"},
        ],
        pages=[
            page("e1", "Acme (Senior Product Manager)", ["Applied 🙂", "Won't be moving forward"]),
            page("e2", "Beta (Product Lead)", ["Applied 🙂", "Interview"]),
        ],
    )
    stats = run(fake)
    assert fake.history == [] and stats.counts == {}
    assert len(fake.jobs) == 2


def test_unchanged_pages_are_skipped_on_the_next_run():
    fake = Fake(pages=[page("f1", "Wolt (Product Lead)", ["Applied 🙂"])])
    run(fake)
    stats = run(fake)
    assert stats.pages == 1 and stats.counts == {} and len(fake.history) == 1


def test_a_failing_page_is_retried_and_does_not_stop_the_rest():
    fake = Fake(
        pages=[
            page("g1", "Wolt (Product Lead)", ["Applied 🙂"]),
            page("g2", "Beta (Product Lead)", ["Applied 🙂"]),
        ]
    )
    real = fake.__call__

    def flaky(req):
        if req.method == "POST" and req.url.path.endswith("/jobs") and b"notion:g1" in req.content:
            return httpx.Response(500)
        return real(req)

    t = httpx.MockTransport(flaky)
    store = SupabaseStore("https://p.supabase.co", "sb_secret_x", transport=t)
    stats = NotionSync(store, Notion("s", transport=t), Enricher(RULES)).run("ds", since=None)
    assert stats.errors == 1 and "notion:g2" in fake.jobs
    assert fake.notion_pages["g1"]["last_error"].startswith("HTTPStatusError")
    run(fake)
    assert fake.jobs["notion:g1"]["status"] == "applied"


def test_dry_run_writes_nothing():
    fake = Fake(pages=[page("h1", "Wolt (Product Lead)", ["Applied 🙂"])])
    t = httpx.MockTransport(fake)
    store = SupabaseStore("https://p.supabase.co", "sb_secret_x", transport=t)
    sync = NotionSync(store, Notion("s", transport=t), Enricher(RULES), dry_run=True)
    stats = sync.run("ds", since=None)
    assert stats.counts["new_tracked"] == 1 and stats.counts["to_applied"] == 1
    assert fake.jobs == {} and fake.history == [] and fake.notion_pages == {}
