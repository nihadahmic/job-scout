import pytest

from collector.models import Job


def job(title="Senior Product Manager", location="Remote", description="", remote=True, **extra):
    return Job(
        "test",
        "1",
        "https://x",
        "Acme",
        title,
        location,
        remote,
        None,
        description,
        None,
        None,
        extra=extra,
    )


@pytest.mark.parametrize(
    "title",
    [
        "Senior Product Manager",
        "Product Owner",
        "Business Analyst",
        "Technical Project Manager",
        "Implementation Manager",
        "Lead Product Manager",
        "Senior PM, Payments",
    ],
)
def test_keeps_target_titles(prefilter, title):
    assert prefilter.check(job(title, "Europe")).keep


@pytest.mark.parametrize(
    ("title", "reason"),
    [
        ("Senior Software Engineer", "title:role"),
        ("Product Designer", "title:role"),
        ("Product Marketing Manager", "title:role"),
        ("Junior Product Manager", "title:seniority"),
        ("Associate Product Manager", "title:seniority"),
        ("Product Management Intern", "title:seniority"),
        ("Staff Product Manager", "title:seniority"),
        ("Principal Product Manager", "title:seniority"),
        ("Director of Product Management", "title:seniority"),
        ("Head of Product Management", "title:seniority"),
        ("VP, Product Management", "title:seniority"),
    ],
)
def test_drops_other_titles(prefilter, title, reason):
    assert prefilter.check(job(title, "Europe")).reason == reason


def test_remote_stage(prefilter):
    assert prefilter.check(job(remote=False, location="Europe")).reason == "remote:not_remote"
    assert prefilter.check(job(location="Hybrid - Berlin")).reason == "remote:hybrid_or_onsite"
    assert (
        prefilter.check(job("Product Manager (On-site)", "Europe")).reason
        == "remote:hybrid_or_onsite"
    )


@pytest.mark.parametrize(
    "location",
    [
        "Remote - EMEA",
        "Europe Only",
        "Remote, CET +/- 2h",
        "UTC+1 to UTC+3",
        "Bosnia and Herzegovina",
        "Belgrade, Serbia (Remote)",
        "Croatia",
        "Worldwide",
        "Anywhere in the World",
        "LATAM, Europe, USA, Canada, APAC",
        "52 countries (includes Bosnia and Herzegovina)",
    ],
)
def test_location_allowed(prefilter, location):
    assert prefilter.check(job(location=location)).keep


@pytest.mark.parametrize(
    ("location", "reason"),
    [
        ("USA Only", "location:us_only"),
        ("Remote - United States", "location:us_only"),
        ("North America Only", "location:us_only"),
        ("Anywhere in the World, 🇺🇸 United States of America", "location:us_only"),
        ("United Kingdom", "location:uk_only"),
        ("Remote (UK)", "location:uk_only"),
        ("Remote, EU", "location:eu_only"),
        ("Latin America Only", "location:latam_only"),
        ("Remote - Germany", "location:other_place"),
        ("Spain", "location:other_place"),
        ("Remote", "location:unclear"),
    ],
)
def test_location_dropped(prefilter, location, reason):
    assert prefilter.check(job(location=location)).reason == reason


def test_restriction_in_title_beats_country_list(prefilter):
    j = job("Product Owner (EU only)", "52 countries (includes Bosnia and Herzegovina)")
    assert prefilter.check(j).reason == "location:eu_only_in_title"
    j = job("Senior Product Manager (Europe/US - Remote)", "Worldwide")
    assert prefilter.check(j).keep


def test_vague_location_falls_back_to_description(prefilter):
    j = job(location="Remote", description="We hire across Europe on CET hours.")
    assert prefilter.check(j).keep


@pytest.mark.parametrize(
    ("description", "keep"),
    [
        ("We hire worldwide.", True),
        ("Work from anywhere in the world.", True),
        ("A global leader in payments.", False),
    ],
)
def test_vague_location_anywhere_in_description(prefilter, description, keep):
    assert prefilter.check(job(location="Remote", description=description)).keep is keep


def test_structured_country_list(prefilter):
    j = job(location="Remote", location_restrictions=["Serbia", "Croatia"])
    assert prefilter.check(j).keep


@pytest.mark.parametrize(
    "description",
    [
        "You must have the right to work in the EU.",
        "Legally eligible to work in the U.S. on an ongoing basis",
        "Candidates must be based in the United Kingdom.",
        "An EU work permit is required.",
        "This role requires US citizenship.",
    ],
)
def test_authorization_dropped(prefilter, description):
    j = job(location="Europe", description=description)
    assert prefilter.check(j).reason == "authorization:permit_required"


@pytest.mark.parametrize(
    "description",
    [
        "Must be based in EU timezone.",
        "You must be located in Europe.",
        "Eligible to work in the country where you live.",
        "Must be authorized to work in your country of residence.",
        "Must reside in Bosnia and Herzegovina or Serbia.",
    ],
)
def test_authorization_allowed(prefilter, description):
    assert prefilter.check(job(location="Europe", description=description)).keep
