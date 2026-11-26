import json
import sqlite3

import httpx

from collector.models import Job
from collector.prefilter import Verdict
from collector.run import collect, source_lines, summary_line
from collector.store import Store


class KeepAll:
    def check(self, job):
        return Verdict(True)


def _job(source: str, source_id: str, company: str, title: str) -> Job:
    return Job(
        source, source_id, "https://x", company, title, "Worldwide", True, None, "", None, None
    )


def test_run_twice_adds_nothing_new(tmp_path, fixture_client, all_routes, config):
    store = Store(tmp_path / "jobs.sqlite")

    first = collect(
        config,
        store,
        fixture_client(all_routes),
        KeepAll(),
        now=lambda: "2026-11-25T07:30:00+00:00",
    )
    assert {k: v.new for k, v in first.items()} == {
        "himalayas": 3,
        "remotive": 3,
        "weworkremotely": 3,
    }
    assert store.count() == 9

    second = collect(
        config,
        store,
        fixture_client(all_routes),
        KeepAll(),
        now=lambda: "2026-11-26T07:30:00+00:00",
    )
    assert sum(s.new for s in second.values()) == 0
    assert sum(s.known for s in second.values()) == 9
    assert store.count() == 9

    # first_seen_at stays at the first run
    seen = {r[0] for r in store.conn.execute("SELECT first_seen_at FROM jobs")}
    assert seen == {"2026-11-25T07:30:00+00:00"}
    assert store.conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0] == 2


def test_cross_source_duplicate_is_skipped(tmp_path):
    store = Store(tmp_path / "jobs.sqlite")
    assert store.add(_job("himalayas", "a/1", "Acme GmbH", "Product Owner (Remote)"), "t") == "new"
    assert store.add(_job("weworkremotely", "acme-po", "Acme", "Product Owner"), "t") == "duplicate"
    assert (
        store.add(_job("himalayas", "a/1", "Acme GmbH", "Product Owner (Remote)"), "t") == "known"
    )
    assert store.count() == 1


def test_failing_source_does_not_stop_others(tmp_path, fixture_client, all_routes, config):
    routes = dict(all_routes)
    request = httpx.Request("GET", "https://remotive.com/api/remote-jobs")
    routes["https://remotive.com/api/remote-jobs"] = httpx.HTTPStatusError(
        "429 Too Many Requests", request=request, response=httpx.Response(429, request=request)
    )
    store = Store(tmp_path / "jobs.sqlite")
    stats = collect(config, store, fixture_client(routes), KeepAll())

    assert stats["remotive"].errors == 1
    assert stats["himalayas"].new == 3
    assert stats["weworkremotely"].new == 3
    line = summary_line(stats, store.count())
    assert "remotive fetched=0 company=0 title=0 remote=0 location=0 authorization=0 new=0" in line
    assert "remotive fetched=0" in line and "errors=1" in line
    assert line.endswith("in_db=6")


def test_stored_row_matches_schema(tmp_path, fixture_client, all_routes, config):
    db = tmp_path / "jobs.sqlite"
    store = Store(db)
    collect(config, store, fixture_client(all_routes), KeepAll(), only=["remotive"])
    store.close()

    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    row = conn.execute("SELECT * FROM jobs WHERE id = 'remotive:2091179'").fetchone()
    assert row["status"] == "new"
    assert row["reply"] == "none"
    assert row["tier"] is None
    assert json.loads(row["extra"])["job_type"] == "contract"


def test_real_rules_count_each_stage(tmp_path, fixture_client, all_routes, config, prefilter):
    store = Store(tmp_path / "jobs.sqlite")
    stats = collect(config, store, fixture_client(all_routes), prefilter)

    him = stats["himalayas"]
    assert him.fetched == 3
    assert him.passed["title"] == 1  # "Manager, Product Manager"
    assert him.dropped == {"title:role": 1, "title:seniority": 1}
    assert stats["remotive"].dropped == {"title:role": 3}
    assert stats["weworkremotely"].new == 1  # "Product Manager, Care Delivery", anywhere
    assert store.count() == 2

    lines = source_lines(stats)
    assert lines[0].startswith(
        "himalayas: fetched=3 company=3 title=1 remote=1 location=1 authorization=1"
    )
    assert "dropped: title:role=1, title:seniority=1" in lines[0]


def test_prefilter_marks_previously_stored_rows(tmp_path, prefilter):
    store = Store(tmp_path / "jobs.sqlite")
    old = Job(
        "remotive",
        "1",
        "https://x",
        "Acme",
        "WordPress Developer",
        "USA",
        True,
        None,
        "",
        None,
        None,
    )
    store.add(old, "t")
    store.mark_dropped(old.id, "title:role")
    reason = store.conn.execute("SELECT dropped_reason FROM jobs").fetchone()[0]
    assert reason == "title:role"
