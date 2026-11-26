from collector.sources.feed import Feeds, parse_feed, split_title


def feeds_for(fixture_client, routes, rows):
    return Feeds(fixture_client(routes), {"_feeds": rows})


def test_rss_feed(fixture_client):
    src = feeds_for(
        fixture_client,
        {"https://feed.test/rss": "feeds/rss.xml"},
        [
            {
                "id": 7,
                "name": "Example Remote Jobs",
                "url": "https://feed.test/rss",
                "all_remote": True,
            }
        ],
    )
    jobs = {j.title: j for j in map(src.normalize, src.fetch())}
    spm = jobs["Senior Product Manager"]
    assert spm.company == "Acme" and spm.location_text == "Europe Only" and spm.remote
    assert (
        spm.posted_at == "2026-11-25T06:02:20+00:00" and "Remote across Europe" in spm.description
    )
    assert spm.source == "feeds" and spm.source_id.startswith("7/")
    assert jobs["Product Owner"].company == "Globex"
    ba = jobs["Business Analyst"]
    assert ba.company == "Initech" and ba.location_text == "Remote, CET"


def test_atom_feed_uses_feed_name_when_no_company(fixture_client):
    src = feeds_for(
        fixture_client,
        {"https://acme.test/atom": "feeds/atom.xml"},
        [{"id": 9, "name": "Acme Careers", "url": "https://acme.test/atom", "all_remote": False}],
    )
    [job] = [src.normalize(r) for r in src.fetch()]
    assert (
        job.title == "Technical Project Manager" and job.url == "https://careers.acme.test/jobs/42"
    )
    assert (
        job.company == "Acme Careers" and job.remote is False and job.location_text == "Unspecified"
    )
    assert job.posted_at == "2026-11-20T09:00:00+00:00"


def test_broken_feed_is_an_error_for_that_feed(fixture_client):
    src = feeds_for(fixture_client, {}, [{"id": 3, "name": "Gone", "url": "https://gone.test/rss"}])
    assert src.fetch() == [] and 3 in src.errors_by_key and src.stat_rows == [3]


def test_split_title():
    assert split_title("Acme: Product Manager") == ("Acme", "Product Manager")
    assert split_title("Product Manager at Acme Inc") == ("Acme Inc", "Product Manager")
    assert split_title("Product Manager - Payments", fallback="Board") == (
        "Board",
        "Product Manager - Payments",
    )
    assert split_title("Senior PM", company="Initech") == ("Initech", "Senior PM")


def test_parse_feed_rejects_html():
    import xml.etree.ElementTree as ET

    import pytest

    with pytest.raises(ET.ParseError):
        parse_feed("<html><body>not a feed</body></html><p>")
