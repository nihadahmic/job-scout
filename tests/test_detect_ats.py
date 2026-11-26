import pytest

from scripts.detect_ats import (
    Detection,
    Page,
    careers_link,
    detect_company,
    detect_in,
    slug_candidates,
)
from scripts.import_companies import merge


@pytest.mark.parametrize(
    ("text", "ats", "slug", "region"),
    [
        ('<a href="https://boards.greenhouse.io/acme">', "greenhouse", "acme", None),
        ('<a href="https://job-boards.greenhouse.io/acme/jobs/123">', "greenhouse", "acme", None),
        ('<a href="https://job-boards.eu.greenhouse.io/acme">', "greenhouse", "acme", "eu"),
        (
            '<script src="https://boards.greenhouse.io/embed/job_board/js?for=acme">',
            "greenhouse",
            "acme",
            None,
        ),
        ("https://jobs.lever.co/acme/abc-123", "lever", "acme", None),
        ("https://jobs.eu.lever.co/acme", "lever", "acme", "eu"),
        ("https://jobs.ashbyhq.com/acme", "ashby", "acme", None),
        ("https://apply.workable.com/acme/", "workable", "acme", None),
        ("https://acme.jobs.personio.de/job/1", "personio", "acme", None),
        ("https://acme.recruitee.com/o/pm", "recruitee", "acme", None),
        ("https://jobs.smartrecruiters.com/AcmeInc/123", "smartrecruiters", "AcmeInc", None),
        ("https://acme.teamtailor.com/jobs", "teamtailor", "acme", None),
        ("https://acme.breezy.hr/p/123", "breezy", "acme", None),
        ("https://acme.bamboohr.com/careers/12", "bamboohr", "acme", None),
        ("https://acme.pinpointhq.com/en/postings/abc", "pinpoint", "acme", None),
    ],
)
def test_detect_in(text, ats, slug, region):
    d = detect_in(text)
    assert (d.ats, d.slug, d.region) == (ats, slug, region)


def test_detect_ignores_asset_paths_and_picks_most_referenced():
    html = (
        '<script src="https://boards.greenhouse.io/embed/job_board/js"></script>'
        '<a href="https://jobs.lever.co/acme/1"></a><a href="https://jobs.lever.co/acme/2"></a>'
        '<a href="https://jobs.ashbyhq.com/other"></a>'
    )
    d = detect_in(html)
    assert (d.ats, d.slug) == ("lever", "acme")


@pytest.mark.parametrize(
    "text",
    [
        '<script src="https://careers-analytics.recruitee.com/t.js">',  # tracking script
        '<a href="https://apply.workable.com/j/ABC123">',  # job link, no account slug
    ],
)
def test_not_a_board_slug(text):
    assert detect_in(text) is None


def test_no_ats():
    assert detect_in("<html>We use our own careers page.</html>") is None


def test_careers_link_skips_feeds_and_assets():
    page = Page(
        "https://acme.test/",
        200,
        '<link href="/careers/feed/"><link href="/jobs.css"><a href="/careers/">Careers</a>',
    )
    assert careers_link(page) == "https://acme.test/careers/"


def test_slug_candidates():
    assert slug_candidates("Acme Labs", "https://www.acme.io/careers") == ["acme", "acmelabs"]


def test_detect_company_follows_careers_link_then_probes():
    pages = {
        "https://acme.test": Page("https://acme.test/", 200, '<a href="/careers">Careers</a>'),
        "https://acme.test/careers": Page(
            "https://acme.test/careers", 200, '<div id="greenhouse-open-roles"></div>'
        ),
        "https://boards-api.greenhouse.io/v1/boards/acme": Page(
            "https://boards-api.greenhouse.io/v1/boards/acme", 200, '{"name": "Acme"}'
        ),
    }
    d = detect_company("https://acme.test", lambda url: pages[url.rstrip("/")], "Acme")
    assert (d.ats, d.slug) == ("greenhouse", "acme")
    assert d.note == "slug guessed, confirmed via API"


def test_detect_company_blocked_and_login_walled():
    blocked = detect_company("https://acme.test", lambda url: Page(url, 429, ""), "Acme")
    assert blocked == Detection("unknown", note="blocked (HTTP 429)")
    walled = detect_company("https://angel.co/acme/jobs", lambda url: 1 / 0, "Acme")
    assert walled.ats == "unknown" and "not fetched" in walled.note


def test_detect_company_uses_url_without_fetching():
    d = detect_company("https://acme.breezy.hr", lambda url: 1 / 0, "Acme")
    assert (d.ats, d.slug) == ("breezy", "acme")


def test_import_merge_dedupes_by_site_and_keeps_detection():
    existing = [{"name": "Acme", "website": "https://acme.test/", "ats": "lever", "slug": "acme"}]
    incoming = [
        {"name": "Acme Inc", "about": "", "hq": "UK", "website": "https://www.acme.test"},
        {"name": "Acme Inc", "about": "", "hq": "UK", "website": "http://acme.test/"},
        {"name": "CRISP", "about": "", "hq": "ES", "website": "https://crisp.example"},
    ]
    companies, counts = merge(existing, incoming)
    assert counts == {"added": 1, "updated": 1, "duplicate_in_csv": 1}
    acme = next(c for c in companies if c["website"].endswith("acme.test"))
    assert acme["name"] == "Acme Inc" and acme["ats"] == "lever"
