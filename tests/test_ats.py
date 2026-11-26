"""ATS fetchers: each reads a saved board response for a fake company "acme"."""

import pytest
import yaml

from collector.run import collect
from collector.sources.ats.ashby import Ashby
from collector.sources.ats.greenhouse import Greenhouse
from collector.sources.ats.lever import Lever
from collector.sources.ats.recruitee import Recruitee
from collector.sources.ats.teamtailor import Teamtailor
from collector.sources.ats.workable import Workable
from collector.store import Store

ROUTES = {
    "https://boards-api.greenhouse.io/v1/boards/acme/jobs": "ats/greenhouse_acme.json",
    "https://api.lever.co/v0/postings/acme": "ats/lever_acme.json",
    "https://api.ashbyhq.com/posting-api/job-board/acme": "ats/ashby_acme.json",
    "https://apply.workable.com/api/v1/widget/accounts/acme": "ats/workable_acme.json",
    "https://acme.recruitee.com/api/offers/": "ats/recruitee_acme.json",
    "https://acme.teamtailor.com/jobs.rss": "ats/teamtailor_acme.rss",
}


@pytest.fixture
def watchlist(tmp_path):
    companies = [
        {"name": "Acme", "website": "https://acme.test", "ats": ats, "slug": "acme"}
        for ats in ("greenhouse", "lever", "ashby", "workable", "recruitee", "teamtailor")
    ]
    companies.append({"name": "Nobody", "website": "https://x.test", "ats": "unknown"})
    path = tmp_path / "companies.yaml"
    path.write_text(yaml.safe_dump({"companies": companies}))
    return path


def jobs_for(cls, fixture_client, watchlist):
    source = cls(fixture_client(ROUTES), {"companies_file": str(watchlist)})
    return {j.title: j for j in map(source.normalize, source.fetch())}


def test_greenhouse(fixture_client, watchlist):
    jobs = jobs_for(Greenhouse, fixture_client, watchlist)
    pm = jobs["Senior Product Manager"]
    assert pm.remote and pm.location_text == "Remote - EMEA"
    assert pm.company == "Acme"
    assert pm.source_id.startswith("acme/")
    assert "CET hours" in pm.description and "<p>" not in pm.description
    assert pm.posted_at.endswith("+00:00")
    assert jobs["Account Manager"].remote is False


def test_lever(fixture_client, watchlist):
    jobs = jobs_for(Lever, fixture_client, watchlist)
    po = jobs["Product Owner"]
    assert po.remote and po.location_text == "Europe"
    assert po.salary_text.startswith("GBP 74,800-112,200")
    assert "Placeholder item" in po.description
    assert jobs["Product Manager"].remote is False  # workplaceType hybrid


def test_ashby(fixture_client, watchlist):
    jobs = jobs_for(Ashby, fixture_client, watchlist)
    assert "Unlisted Product Manager" not in jobs
    growth = jobs["Product Manager, Growth"]
    assert growth.remote and growth.location_text == "Remote, Europe"
    # isRemote is true but workplaceType says Hybrid
    assert jobs["Product Manager, Care"].remote is False


def test_workable(fixture_client, watchlist):
    jobs = jobs_for(Workable, fixture_client, watchlist)
    assert jobs["Senior Product Manager"].location_text == "Remote"
    assert jobs["Product Manager"].location_text == "Remote, India"
    assert all(j.source_id.startswith("acme/") for j in jobs.values())


def test_recruitee(fixture_client, watchlist):
    jobs = jobs_for(Recruitee, fixture_client, watchlist)
    assert jobs["Business Analyst"].remote
    assert jobs["Office Cat"].remote is False
    assert jobs["Business Analyst"].posted_at.endswith("+00:00")


def test_teamtailor(fixture_client, watchlist):
    jobs = jobs_for(Teamtailor, fixture_client, watchlist)
    tpm = jobs["Technical Project Manager"]
    assert tpm.remote and tpm.location_text == "Remote, Milano, Italy"
    assert jobs["Product Manager"].remote is False  # remoteStatus hybrid


def test_teamtailor_custom_domain_url():
    source = Teamtailor(None, {})
    assert source.board_url("careers.acme.io", None) == "https://careers.acme.io/jobs.rss"
    assert source.board_url("acme", None) == "https://acme.teamtailor.com/jobs.rss"


def test_lever_eu_region():
    assert Lever(None, {}).board_url("acme", "eu").startswith("https://api.eu.lever.co/")


def test_broken_board_is_an_error_not_a_crash(fixture_client, watchlist, tmp_path):
    routes = dict(ROUTES)
    routes.pop("https://api.lever.co/v0/postings/acme")  # FixtureClient raises on this URL
    source = Lever(fixture_client(routes), {"companies_file": str(watchlist)})
    assert source.fetch() == []
    assert len(source.errors) == 1 and source.errors[0].startswith("acme:")


def test_missing_watchlist_is_reported(fixture_client, tmp_path, prefilter):
    config = {"greenhouse": {"companies_file": str(tmp_path / "missing.yaml")}}
    stats = collect(config, Store(tmp_path / "jobs.sqlite"), fixture_client(ROUTES), prefilter)
    assert stats["greenhouse"].errors == 1
    assert "watchlist not found" in stats["greenhouse"].error_messages[0]


def test_ats_jobs_go_through_prefilter(fixture_client, watchlist, tmp_path, prefilter):
    config = {"ats": {"companies_file": str(watchlist)}} | {
        name: {} for name in ("greenhouse", "lever", "ashby", "workable", "recruitee", "teamtailor")
    }
    store = Store(tmp_path / "jobs.sqlite")
    stats = collect(config, store, fixture_client(ROUTES), prefilter)

    assert stats["greenhouse"].new == 1  # Senior PM, Remote - EMEA
    assert stats["lever"].dropped["remote:not_remote"] == 1
    # plain "Remote", description says "hire worldwide". Not new: every fixture company is
    # "Acme", so it dedupes against the Greenhouse "Senior Product Manager".
    assert stats["workable"].passed["authorization"] == 1
    assert stats["workable"].duplicate == 1
    assert stats["workable"].dropped["location:other_place"] == 1  # Remote, India
    assert stats["teamtailor"].dropped["location:other_place"] == 1  # Remote, Milano, Italy
    assert stats["recruitee"].new == 1  # Remote, Croatia
