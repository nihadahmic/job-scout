from pathlib import Path

import pytest
import yaml

from collector.enrich import Enricher
from collector.models import Job

RULES = yaml.safe_load((Path(__file__).parent.parent / "config" / "rules.yaml").read_text())


@pytest.fixture(scope="module")
def enricher():
    return Enricher(RULES)


@pytest.mark.parametrize(
    ("title", "category"),
    [
        ("Senior Product Manager", "product_manager"),
        ("Product Lead - Infrastructure", "product_manager"),
        ("Business Analyst / Product Owner fluent in German", "product_owner"),
        ("Senior Business Analyst", "business_analyst"),
        ("Technical Project Manager", "project_manager"),
        ("Senior Implementation Consultant", "implementation"),
        ("Data Engineer", None),
    ],
)
def test_category(enricher, title, category):
    assert enricher.category(title) == category


@pytest.mark.parametrize(
    ("text", "lo", "hi"),
    [
        ("EUR 70,000-90,000 / annual", 5833, 7500),
        ("EUR 5,000-7,500 / monthly", 5000, 7500),
        ("GBP 74,800-112,200 / per-year-salary", 7168, 10752),
        ("$57K - $67K", 4275, 5025),  # no period, large: annual
        ("$35,3k- $52k", 2648, 3900),  # decimal comma before k
        ("$50-$75 /hour", 7200, 10800),
        ("$3.5k–$5k/month", 3150, 4500),
        ("€4,500 - €6,000", 4500, 6000),  # no period, mid-size: monthly
        ("HUF 18,000,000-33,000,000 / annual", 3750, 6875),
    ],
)
def test_salary(enricher, text, lo, hi):
    r = enricher.salary(text)
    assert (r.min_eur_month, r.max_eur_month) == (lo, hi)


@pytest.mark.parametrize("text", [None, "", "Competitive", "Equity only", "XYZ 50,000"])
def test_salary_unparseable(enricher, text):
    assert enricher.salary(text) is None


def _job(location, description=""):
    return Job(
        "t", "1", "u", "Acme", "Product Manager", location, True, None, description, None, None
    )


@pytest.mark.parametrize(
    ("location", "description", "match"),
    [
        ("Bosnia and Herzegovina", "", "balkans"),
        ("Remote - EMEA", "", "europe"),
        ("Remote, CET +/- 2h", "", "cet"),
        ("Worldwide", "", "worldwide"),
        ("Remote", "We hire worldwide.", "description"),
    ],
)
def test_location_match(prefilter, location, description, match):
    assert prefilter.location_match(_job(location, description)) == match


def test_collect_stores_enriched_fields(tmp_path, fixture_client, all_routes, config, prefilter):
    from collector.run import collect
    from collector.store import Store

    store = Store(tmp_path / "jobs.sqlite")
    collect(config, store, fixture_client(all_routes), prefilter, enricher=Enricher(RULES))
    row = store.conn.execute(
        "SELECT category, location_match FROM jobs WHERE source = 'weworkremotely'"
    ).fetchone()
    assert row == ("product_manager", "worldwide")
