"""SupabaseStore against a tiny in-memory stand-in for PostgREST (no network)."""

import json
import re
from urllib.parse import parse_qs

import httpx
import pytest

from collector.models import Job
from collector.supabase_store import SupabaseStore, _in


class FakePostgrest:
    def __init__(self):
        self.jobs: dict[str, dict] = {}
        self.runs: list[dict] = []
        self.requests: list[httpx.Request] = []

    @staticmethod
    def _values(expr: str) -> list[str]:
        inner = re.fullmatch(r"in\.\((.*)\)", expr).group(1)
        return [v.replace('\\"', '"') for v in re.findall(r'"((?:[^"\\]|\\.)*)"', inner)]

    def _match(self, row: dict, params: dict) -> bool:
        for col, [expr] in params.items():
            if col in ("select", "order", "limit", "offset", "on_conflict"):
                continue
            if expr.startswith("in.") and row.get(col) not in self._values(expr):
                return False
            if expr == "is.null" and row.get(col) is not None:
                return False
            if expr == "not.is.null" and row.get(col) is None:
                return False
            if expr.startswith("eq.") and row.get(col) != expr[3:]:
                return False
        return True

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        params = parse_qs(request.url.query.decode())
        table = request.url.path.rsplit("/", 1)[-1]
        if table == "runs":
            self.runs.append(json.loads(request.content))
            return httpx.Response(201)
        if request.method == "GET":
            rows = [r for r in self.jobs.values() if self._match(r, params)]
            if request.headers.get("Prefer") == "count=exact":
                return httpx.Response(206, json=[], headers={"content-range": f"0-0/{len(rows)}"})
            cols = params["select"][0].split(",")
            return httpx.Response(200, json=[{c: r.get(c) for c in cols} for r in rows])
        if request.method == "POST":
            for row in json.loads(request.content):
                self.jobs.setdefault(
                    row["id"], {"status": "new", "tier": None, "dropped_reason": None, **row}
                )
            return httpx.Response(201)
        if request.method == "PATCH":
            body = json.loads(request.content)
            changed = [r for r in self.jobs.values() if self._match(r, params)]
            for r in changed:
                r.update(body)
            return httpx.Response(200, json=changed)
        return httpx.Response(405)


def job(source_id, company="Acme", title="Product Manager", source="ashby"):
    return Job(
        source,
        source_id,
        "https://x",
        company,
        title,
        "Europe",
        True,
        None,
        "",
        None,
        None,
        category="product_manager",
        location_match="europe",
    )


@pytest.fixture
def fake():
    return FakePostgrest()


@pytest.fixture
def store(fake):
    return SupabaseStore(
        "https://proj.supabase.co", "sb_secret_test", transport=httpx.MockTransport(fake)
    )


def test_add_many_new_known_duplicate(store, fake):
    first = store.add_many(
        [job("acme/1"), job("acme/2", title="Product Owner")], "2026-11-26T07:30:00+00:00"
    )
    assert first == ["new", "new"]
    second = store.add_many(
        [job("acme/1"), job("other/9", company="ACME Inc.", title="Product Manager (Remote)")],
        "2026-11-27T07:30:00+00:00",
    )
    assert second == ["known", "duplicate"]
    assert set(fake.jobs) == {"ashby:acme/1", "ashby:acme/2"}
    assert fake.jobs["ashby:acme/1"]["first_seen_at"] == "2026-11-26T07:30:00+00:00"
    assert fake.jobs["ashby:acme/1"]["location_match"] == "europe"


def test_duplicates_inside_one_batch(store, fake):
    out = store.add_many([job("a/1"), job("b/1", source="lever")], "t")
    assert out == ["new", "duplicate"]
    assert len(fake.jobs) == 1


def test_large_batches_are_chunked(store, fake):
    jobs = [job(f"acme/{i}", title=f"Product Manager {i}") for i in range(250)]
    assert store.add_many(jobs, "t").count("new") == 250
    posts = [r for r in fake.requests if r.method == "POST"]
    assert [len(json.loads(r.content)) for r in posts] == [100, 100, 50]


def test_mark_dropped_skips_touched_jobs(store, fake):
    store.add_many([job("acme/1"), job("acme/2", title="Product Owner")], "t")
    fake.jobs["ashby:acme/2"]["status"] = "applied"
    changed = store.mark_dropped_many({"ashby:acme/1": "title:role", "ashby:acme/2": "title:role"})
    assert changed == 1
    assert fake.jobs["ashby:acme/1"]["dropped_reason"] == "title:role"
    assert fake.jobs["ashby:acme/2"]["dropped_reason"] is None


def test_count_and_runs(store, fake):
    store.add_many([job("acme/1")], "t")
    store.record_run("s", "f", {"ashby": {"new": 1}})
    assert store.count() == 1
    assert fake.runs == [{"started_at": "s", "finished_at": "f", "summary": {"ashby": {"new": 1}}}]


def test_auth_headers(fake):
    new_key = SupabaseStore(
        "https://p.supabase.co", "sb_secret_x", transport=httpx.MockTransport(fake)
    )
    new_key.count()
    assert fake.requests[-1].headers["apikey"] == "sb_secret_x"
    assert "authorization" not in fake.requests[-1].headers
    legacy = SupabaseStore(
        "https://p.supabase.co", "eyJhbGciOi", transport=httpx.MockTransport(fake)
    )
    legacy.count()
    assert fake.requests[-1].headers["authorization"] == "Bearer eyJhbGciOi"


def test_in_filter_quotes_ids():
    assert _in(["ashby:acme/1", 'x"y']) == 'in.("ashby:acme/1","x\\"y")'


def test_refilter_marks_rows_that_fail_rules(store, fake, prefilter):
    from collector.refilter import refilter

    store.add_many([job("acme/1"), job("acme/2", title="Data Engineer")], "t")
    for row in fake.jobs.values():
        row.update(posted_at=None, description="", salary_text=None, apply_url=None, extra={})
    counts, restored = refilter(store, prefilter)
    assert counts == {"title:role": 1} and restored == 0
    assert fake.jobs["ashby:acme/2"]["dropped_reason"] == "title:role"


def test_refilter_restores_jobs_that_pass_again(store, fake, prefilter):
    from collector.refilter import refilter

    store.add_many([job("acme/1")], "t")
    row = fake.jobs["ashby:acme/1"]
    row.update(posted_at=None, description="", salary_text=None, apply_url=None, extra={})
    row["dropped_reason"] = "location:other_place"  # dropped under older, stricter rules
    counts, restored = refilter(store, prefilter)
    assert restored == 1 and not counts
    assert row["dropped_reason"] is None and row["location_match"] == "europe"

    row["dropped_reason"] = "screening:low_fit"  # not a prefilter drop: left alone
    _, restored = refilter(store, prefilter)
    assert restored == 0 and row["dropped_reason"] == "screening:low_fit"
