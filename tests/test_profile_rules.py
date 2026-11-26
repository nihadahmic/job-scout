"""Profile preferences -> prefilter rules."""

import copy
from pathlib import Path

import pytest
import yaml

from collector.models import Job
from collector.prefilter import Prefilter
from collector.profile_rules import apply_profile, describe

RULES = yaml.safe_load((Path(__file__).parent.parent / "config" / "rules.yaml").read_text())

DEFAULT_PREFS = {
    "categories": [
        "product_manager",
        "product_owner",
        "business_analyst",
        "project_manager",
        "implementation",
    ],
    "exclude_seniority": [
        "intern",
        "junior",
        "associate",
        "staff",
        "principal",
        "director",
        "head",
        "vp",
    ],
    "work": {"remote": True, "sarajevo_hybrid": True, "contract": True, "employment": True},
    "locations": {
        "balkans": True,
        "europe": True,
        "cet": True,
        "worldwide": True,
        "slovenia": False,
        "montenegro": False,
        "north_macedonia": False,
        "balkans_region": False,
        "cee": False,
        "plain_remote": False,
    },
    "skip_companies": [],
}


def prefs(**changes):
    p = copy.deepcopy(DEFAULT_PREFS)
    for key, value in changes.items():
        if isinstance(value, dict):
            p[key].update(value)
        else:
            p[key] = value
    return p


def job(
    title="Senior Product Manager", location="Europe", remote=True, company="Acme", description=""
):
    return Job("t", "1", "u", company, title, location, remote, None, description, None, None)


def check(p, j):
    return Prefilter(apply_profile(RULES, p)).check(j)


def test_no_profile_keeps_rules_yaml():
    assert apply_profile(RULES, None) == RULES
    assert describe(None) == "no profile, using rules.yaml"


def test_default_profile_matches_rules_yaml_decisions():
    for title in [
        "Senior Product Manager",
        "Staff Product Manager",
        "Business Analyst",
        "Data Engineer",
    ]:
        base = Prefilter(RULES).check(job(title))
        assert check(DEFAULT_PREFS, job(title)).reason == base.reason


def test_categories_limit_titles():
    p = prefs(categories=["product_manager"])
    assert check(p, job("Senior Product Manager")).keep
    assert check(p, job("Business Analyst")).reason == "title:role"


def test_seniority_levels_are_individual():
    p = prefs(exclude_seniority=["junior", "intern"])  # Staff and Associate now allowed
    assert check(p, job("Staff Product Manager")).keep
    assert check(p, job("Associate Product Manager")).keep
    assert check(p, job("Junior Product Manager")).reason == "title:seniority"


def test_skip_companies_ignores_case_and_legal_suffix():
    p = prefs(skip_companies=["Acme GmbH"])
    assert check(p, job(company="ACME")).reason == "company:skipped"
    assert check(p, job(company="Other")).keep


def test_sarajevo_hybrid():
    hybrid = job(location="Sarajevo, BiH (Hybrid)", remote=False)
    assert check(prefs(), hybrid).keep
    assert check(prefs(work={"sarajevo_hybrid": False}), hybrid).reason == "remote:not_remote"
    assert (
        check(prefs(), job(location="Berlin (Hybrid)", remote=False)).reason == "remote:not_remote"
    )


@pytest.mark.parametrize(
    ("option", "location"),
    [
        ("slovenia", "Remote - Slovenia"),
        ("montenegro", "Montenegro"),
        ("north_macedonia", "North Macedonia"),
        ("balkans_region", "Remote, Western Balkans"),
        ("cee", "Remote (CEE)"),
    ],
)
def test_optional_locations(option, location):
    assert not check(prefs(), job(location=location)).keep
    p = prefs(locations={option: True})
    assert check(p, job(location=location)).keep
    assert Prefilter(apply_profile(RULES, p)).location_match(job(location=location)) == option


def test_plain_remote_kept_as_unclear():
    vague = job(location="Remote")
    assert check(prefs(), vague).reason == "location:unclear"
    p = prefs(locations={"plain_remote": True})
    assert check(p, vague).keep
    assert Prefilter(apply_profile(RULES, p)).location_match(vague) == "unclear"


def test_core_groups_can_be_switched_off():
    p = prefs(locations={"worldwide": False, "europe": False})
    assert check(p, job(location="Worldwide")).reason == "location:unclear"
    assert not check(p, job(location="Europe")).keep
    assert check(p, job(location="Bosnia and Herzegovina")).keep


def test_describe():
    line = describe(prefs(skip_companies=["Acme"], locations={"slovenia": True}))
    assert "5 categories" in line and "1 companies skipped" in line and "slovenia" in line
