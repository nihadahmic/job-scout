from collector.sources.himalayas import Himalayas
from collector.sources.remotive import Remotive
from collector.sources.weworkremotely import WeWorkRemotely


def test_himalayas_keeps_worldwide_and_bosnia_drops_other_countries(fixture_client, all_routes):
    client = fixture_client(all_routes)
    source = Himalayas(client, {"queries": ["product manager"], "max_pages_per_query": 3})
    raws = source.fetch()

    titles = {r.payload["title"] for r in raws}
    assert "Product Manager (Germany only)" not in titles
    assert len(raws) == 3
    # fixture page has fewer than 20 jobs, so no second page is requested
    assert len(client.calls) == 1
    assert "country=Bosnia+and+Herzegovina" in client.calls[0]


def test_himalayas_normalize(fixture_client, all_routes):
    source = Himalayas(fixture_client(all_routes), {})
    jobs = {j.title: j for j in map(source.normalize, source.fetch())}

    worldwide = jobs["Product Development Manager - AdTech"]
    assert worldwide.location_text == "Worldwide"
    assert worldwide.source_id == "tradetracker/product-development-manager-adtech"
    assert worldwide.remote is True
    assert worldwide.posted_at.endswith("+00:00")
    assert "<" not in worldwide.description

    emea = jobs["Associate Product Management Consultant (f/m/x)"]
    assert emea.location_text == "148 countries (includes Bosnia and Herzegovina)"
    assert emea.salary_text == "EUR 70,000-90,000 / annual"
    assert "Bosnia and Herzegovina" in emea.extra["location_restrictions"]


def test_remotive_normalize(fixture_client, all_routes):
    source = Remotive(fixture_client(all_routes), {})
    jobs = [source.normalize(r) for r in source.fetch()]

    assert len(jobs) == 3
    job = jobs[0]
    assert job.id == "remotive:2091179"
    assert job.company == "Steward Web Development"
    assert job.salary_text == "$57K - $67K"
    assert job.posted_at == "2026-11-24T10:31:32+00:00"
    assert job.url.startswith("https://remotive.com/")


def test_weworkremotely_normalize(fixture_client, all_routes):
    source = WeWorkRemotely(fixture_client(all_routes), {})
    jobs = {j.source_id: j for j in map(source.normalize, source.fetch())}

    assert len(jobs) == 3
    job = jobs["maven-clinic-product-manager-care-delivery"]
    assert job.company == "Maven Clinic"
    assert job.title == "Product Manager, Care Delivery"
    assert job.posted_at.endswith("+00:00")
    assert "<p>" not in job.description
    # "Fivetran : Manager, ..." has a stray space before the colon
    assert jobs["fivetran-manager-technical-enablement"].company == "Fivetran"
