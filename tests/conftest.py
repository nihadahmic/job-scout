from __future__ import annotations

from pathlib import Path

import httpx
import pytest

FIXTURES = Path(__file__).parent / "fixtures"
WWR_FEED = "https://weworkremotely.com/categories/remote-product-jobs.rss"


class FixtureClient:
    """Stands in for HttpClient. Maps a URL prefix to a saved response; no network."""

    def __init__(self, routes: dict[str, str | Exception]) -> None:
        self.routes = routes
        self.calls: list[str] = []

    def get_text(self, url: str, params: dict | None = None) -> str:
        full = str(httpx.URL(url, params=params))
        self.calls.append(full)
        for prefix, target in self.routes.items():
            if full.startswith(prefix):
                if isinstance(target, Exception):
                    raise target
                return (FIXTURES / target).read_text()
        raise AssertionError(f"unexpected request: {full}")


@pytest.fixture
def fixture_client():
    return FixtureClient


@pytest.fixture
def all_routes() -> dict[str, str]:
    return {
        "https://himalayas.app/jobs/api/search": "himalayas_search_page1.json",
        "https://remotive.com/api/remote-jobs": "remotive.json",
        WWR_FEED: "weworkremotely_product.rss",
    }


@pytest.fixture
def config() -> dict:
    return {
        "himalayas": {"country": "Bosnia and Herzegovina", "queries": ["product manager"]},
        "remotive": {},
        "weworkremotely": {"feeds": [WWR_FEED]},
    }
