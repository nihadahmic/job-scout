"""Detect each watchlist company's applicant tracking system (ATS) and board slug.

Usage: uv run python -m scripts.detect_ats [--file FILE] [--force | --retry-unknown] [--limit N]

For each company: check the website URL itself, then fetch it (following redirects) and look
for ATS links and embeds in the page. If none, follow one careers-looking link (or /careers)
and look again. At most two requests per company, one request per second, 15 s timeout,
responses cached in .cache/ats/. Saves ats, slug, detected_at (or ats: unknown) after every
company, so an interrupted run resumes where it stopped. Prints a summary by ATS.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin, urlparse

import httpx

from collector.text import utc_now
from scripts.companies_file import DEFAULT_PATH, ROOT, load, save

USER_AGENT = "job-scout/0.1 (personal job search tool; checks careers pages once)"
CACHE_DIR = ROOT / ".cache" / "ats"
MAX_BODY = 2_000_000

_SLUG = r"([A-Za-z0-9][A-Za-z0-9._-]*)"
# (ats, pattern, region). Order matters only for readability; detection counts all matches.
PATTERNS: list[tuple[str, re.Pattern[str], str | None]] = [
    ("greenhouse", re.compile(rf"boards-api\.greenhouse\.io/v1/boards/{_SLUG}"), None),
    (
        "greenhouse",
        re.compile(rf"(?:job-)?boards\.eu\.greenhouse\.io/(?:embed/job_board\?for=)?{_SLUG}"),
        "eu",
    ),
    (
        "greenhouse",
        re.compile(rf"(?:job-)?boards\.greenhouse\.io/(?:embed/job_board(?:/js)?\?for=)?{_SLUG}"),
        None,
    ),
    ("greenhouse", re.compile(rf"greenhouse\.io/embed/job_board(?:/js)?\?for={_SLUG}"), None),
    ("lever", re.compile(rf"jobs\.eu\.lever\.co/{_SLUG}"), "eu"),
    ("lever", re.compile(rf"api\.eu\.lever\.co/v0/postings/{_SLUG}"), "eu"),
    ("lever", re.compile(rf"jobs\.lever\.co/{_SLUG}"), None),
    ("lever", re.compile(rf"api\.lever\.co/v0/postings/{_SLUG}"), None),
    ("ashby", re.compile(rf"jobs\.ashbyhq\.com/{_SLUG}"), None),
    ("ashby", re.compile(rf"api\.ashbyhq\.com/posting-api/job-board/{_SLUG}"), None),
    (
        "workable",
        re.compile(rf"apply\.workable\.com/(?:api/v\d/(?:widget/)?accounts/)?{_SLUG}"),
        None,
    ),
    ("workable", re.compile(rf"//{_SLUG}\.workable\.com"), None),
    ("personio", re.compile(rf"//{_SLUG}\.jobs\.personio\.(?:de|com)"), None),
    ("recruitee", re.compile(rf"//{_SLUG}\.recruitee\.com"), None),
    ("smartrecruiters", re.compile(rf"(?:jobs|careers)\.smartrecruiters\.com/{_SLUG}"), None),
    ("smartrecruiters", re.compile(rf"api\.smartrecruiters\.com/v1/companies/{_SLUG}"), None),
    ("teamtailor", re.compile(rf"//{_SLUG}\.teamtailor\.com"), None),
    ("breezy", re.compile(rf"//{_SLUG}\.breezy\.hr"), None),
    ("bamboohr", re.compile(rf"//{_SLUG}\.bamboohr\.com"), None),
    ("pinpoint", re.compile(rf"//{_SLUG}\.pinpointhq\.com"), None),
]
# Path segments and subdomains that are never a company's board slug.
NOT_SLUGS = {
    "j",
    "careers-analytics",
    "analytics",
    "www",
    "apply",
    "api",
    "app",
    "js",
    "embed",
    "v0",
    "v1",
    "jobs",
    "careers",
    "static",
    "assets",
    "cdn",
    "images",
    "resources",
    "help",
    "support",
    "blog",
    "embed.js",
    "widget",
    "accounts",
    "job_board",
    "posting-api",
    "en",
    "de",
    "fr",
    "scripts",
    "assets-cdn",
    "media",
    "teamtailor-cdn",
    "career",
    "company",
    "img",
    "fonts",
    "status",
    "go",
    "marketing",
}
# Teamtailor career sites often run on the company's own domain; these mark one.
TEAMTAILOR_CUSTOM = re.compile(
    r"teamtailor-cdn|teamtailor\.com/(?:assets|packs)|data-teamtailor", re.I
)
CAREERS_LINK = re.compile(
    r"""href=["']([^"'#]*(?:careers?|jobs|join-us|joinus|work-with-us|open-positions|vacancies|hiring)[^"'#]*)["']""",
    re.I,
)
NOT_CAREERS_PAGE = re.compile(
    r"(/feed/?$|\.(css|js|xml|rss|png|jpe?g|svg|gif|pdf|ico|woff2?)(\?|$))", re.I
)
# Pages that name an ATS but load the board with JavaScript, so the slug isn't in the HTML.
# For these we guess the slug and confirm it against the ATS's public API.
HINTS = {
    "greenhouse": re.compile(r"\bgreenhouse\b", re.I),
    "ashby": re.compile(r"\bashby(hq)?\b", re.I),
    "personio": re.compile(r"\bpersonio\b", re.I),
    "recruitee": re.compile(r"\brecruitee\b", re.I),
    "smartrecruiters": re.compile(r"\bsmartrecruiters\b", re.I),
    "teamtailor": re.compile(r"\bteamtailor\b", re.I),
    "bamboohr": re.compile(r"\bbamboohr\b", re.I),
    "pinpoint": re.compile(r"\bpinpointhq\b", re.I),
}
PROBE_URLS = {
    "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{slug}",
    "ashby": "https://api.ashbyhq.com/posting-api/job-board/{slug}",
    "personio": "https://{slug}.jobs.personio.de/xml",
    "recruitee": "https://{slug}.recruitee.com/api/offers/",
    "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{slug}/postings?limit=1",
    "teamtailor": "https://{slug}.teamtailor.com/jobs",
    "bamboohr": "https://{slug}.bamboohr.com/careers/list",
    "pinpoint": "https://{slug}.pinpointhq.com/postings.json",
}
SKIP_HOSTS = {"angel.co", "wellfound.com", "www.angel.co", "linkedin.com", "www.linkedin.com"}


@dataclass
class Page:
    url: str  # final URL after redirects
    status: int
    text: str


@dataclass
class Detection:
    ats: str
    slug: str | None = None
    region: str | None = None
    found_on: str | None = None
    note: str | None = None


def detect_in(text: str) -> Detection | None:
    """Find the most-referenced ATS board in a URL or page. Pure, no network."""
    hits: Counter[tuple[str, str, str | None]] = Counter()
    for ats, pattern, region in PATTERNS:
        for match in pattern.finditer(text):
            slug = match.group(1).strip("._-").rstrip(".")
            slug = re.split(r"[?&#\"'\\]", slug)[0]
            if not slug or slug.lower() in NOT_SLUGS or len(slug) > 60:
                continue
            if ats in {"lever", "ashby", "greenhouse", "smartrecruiters", "workable"}:
                slug = slug.split("/")[0]
            hits[(ats, slug, region)] += 1
    if not hits:
        return None
    (ats, slug, region), _ = hits.most_common(1)[0]
    return Detection(ats, slug, region)


def detect_page(page: Page) -> Detection | None:
    found = detect_in(page.url) or detect_in(page.text)
    if found:
        found.found_on = page.url
        return found
    if TEAMTAILOR_CUSTOM.search(page.text):
        host = urlparse(page.url).netloc
        return Detection("teamtailor", host, found_on=page.url, note="custom domain")
    return None


def careers_link(page: Page) -> str | None:
    """First same-site link that looks like a careers page."""
    base_host = urlparse(page.url).netloc.removeprefix("www.")
    for href in CAREERS_LINK.findall(page.text):
        url = urljoin(page.url, href)
        if NOT_CAREERS_PAGE.search(url):
            continue
        host = urlparse(url).netloc.removeprefix("www.")
        if url.rstrip("/") != page.url.rstrip("/") and (
            host == base_host or host.endswith(base_host)
        ):
            return url
    return None


class Fetcher:
    def __init__(self, delay: float = 1.0, timeout: float = 15.0, cache_dir: Path = CACHE_DIR):
        self.client = httpx.Client(
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,*/*"},
            timeout=timeout,
            follow_redirects=True,
        )
        self.delay = delay
        self.cache_dir = cache_dir
        cache_dir.mkdir(parents=True, exist_ok=True)
        self._last = 0.0
        self.requests = 0

    def get(self, url: str) -> Page:
        path = self.cache_dir / (hashlib.sha256(url.encode()).hexdigest()[:24] + ".json")
        if path.exists():
            return Page(**json.loads(path.read_text()))
        wait = self.delay - (time.monotonic() - self._last)
        if wait > 0:
            time.sleep(wait)
        try:
            r = self.client.get(url)
            page = Page(str(r.url), r.status_code, r.text[:MAX_BODY])
        finally:
            self._last = time.monotonic()
            self.requests += 1
        path.write_text(json.dumps(page.__dict__))
        return page


def slug_candidates(name: str, website: str) -> list[str]:
    host = urlparse(website).netloc.lower().removeprefix("www.")
    label = host.split(".")[0] if host else ""
    compact = re.sub(r"[^a-z0-9]", "", name.lower())
    hyphen = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    out: list[str] = []
    for c in (label, compact, hyphen):
        if c and c not in out and c not in NOT_SLUGS:
            out.append(c)
    return out[:2]


def probe_ok(ats: str, page: Page) -> bool:
    if page.status != 200:
        return False
    if ats == "smartrecruiters":
        return '"totalFound":0' not in page.text.replace(" ", "")
    if ats == "personio":
        return "<workzag-jobs" in page.text
    if ats == "teamtailor":
        return "teamtailor" in page.text.lower()
    return page.text.lstrip().startswith(("{", "["))


def probe_hinted(pages: list[Page], name: str, website: str, fetch) -> Detection | None:
    text = " ".join(p.text for p in pages)
    for ats, hint in HINTS.items():
        if not hint.search(text):
            continue
        for slug in slug_candidates(name, website):
            url = PROBE_URLS[ats].format(slug=slug)
            try:
                page = fetch(url)
            except httpx.HTTPError:
                continue
            if probe_ok(ats, page):
                return Detection(ats, slug, found_on=url, note="slug guessed, confirmed via API")
    return None


def detect_company(website: str, fetch, name: str = "") -> Detection:
    found = detect_in(website)
    if found:
        found.found_on = website
        return found
    if urlparse(website).netloc.lower() in SKIP_HOSTS:
        return Detection("unknown", note="login-walled board, not fetched")
    try:
        page = fetch(website)
    except httpx.HTTPError as exc:
        return Detection("unknown", note=f"fetch failed: {type(exc).__name__}")
    if page.status in (403, 429, 503):
        return Detection("unknown", note=f"blocked (HTTP {page.status})")
    if page.status >= 400:
        return Detection("unknown", note=f"HTTP {page.status}")
    found = detect_page(page)
    if found:
        return found

    next_url = careers_link(page)
    if not next_url and urlparse(page.url).path.strip("/") == "":
        next_url = urljoin(page.url, "/careers")
    pages = [page]
    if next_url:
        try:
            second = fetch(next_url)
        except httpx.HTTPError:
            second = None
        if second and second.status < 400:
            found = detect_page(second)
            if found:
                return found
            pages.append(second)
    return probe_hinted(pages, name, website, fetch) or Detection("unknown", note="no ATS found")


def apply(company: dict, d: Detection, now: str) -> None:
    for key in ("ats", "slug", "ats_region", "ats_found_on", "ats_note", "detected_at"):
        company.pop(key, None)
    company["ats"] = d.ats
    if d.slug:
        company["slug"] = d.slug
    if d.region:
        company["ats_region"] = d.region
    if d.found_on:
        company["ats_found_on"] = d.found_on
    if d.note:
        company["ats_note"] = d.note
    company["detected_at"] = now


def summary(companies: list[dict]) -> str:
    counts = Counter(c.get("ats", "not checked") for c in companies)
    parts = " ".join(f"{k}={v}" for k, v in counts.most_common())
    return f"detect_ats | companies={len(companies)} {parts}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=DEFAULT_PATH)
    parser.add_argument("--force", action="store_true", help="re-check companies already detected")
    parser.add_argument(
        "--retry-unknown", action="store_true", help="re-check only companies marked unknown"
    )
    parser.add_argument("--limit", type=int, help="check at most N companies (for testing)")
    args = parser.parse_args(argv)

    companies = load(args.file)
    if not companies:
        raise SystemExit(f"no companies in {args.file}; run scripts.import_companies first")

    def due(c: dict) -> bool:
        if c.get("ats_locked"):
            return False
        if args.force or "detected_at" not in c:
            return True
        return args.retry_unknown and c.get("ats") == "unknown"

    todo = [c for c in companies if due(c)][: args.limit]
    fetcher = Fetcher()
    for i, company in enumerate(todo, 1):
        d = detect_company(company["website"], fetcher.get, company["name"])
        apply(company, d, utc_now())
        save(companies, args.file)
        detail = " ".join(x for x in (d.ats, d.slug, f"({d.note})" if d.note else None) if x)
        print(f"[{i}/{len(todo)}] {company['name']}: {detail}")
    print(summary(companies) + f" requests={fetcher.requests}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
