"""Text helpers: HTML to plain text, dedupe keys, timestamps."""

from __future__ import annotations

import html
import re
import unicodedata
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser

_BLOCK_TAGS = {"p", "div", "br", "li", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "tr"}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag == "li":
            self.parts.append("\n- ")
        elif tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _BLOCK_TAGS and tag != "li":
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def html_to_text(raw: str | None) -> str:
    """Strip tags and collapse whitespace, keeping paragraph and list breaks."""
    if not raw:
        return ""
    parser = _TextExtractor()
    parser.feed(html.unescape(raw) if "&lt;" in raw else raw)
    text = "".join(parser.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r" *\n *", "\n", text)
    text = re.sub(r"\n(- \n)+", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


_COMPANY_SUFFIXES = re.compile(r"\b(inc|llc|ltd|gmbh|bv|sa|ag|co|corp|limited|d o o)\b")
_TITLE_NOISE = re.compile(r"\b(100 remote|fully remote|remote|m f d|f m x|m w d|f m d|m f x)\b")


def dedupe_key(company: str, title: str) -> str:
    """Key for spotting the same role posted twice (same board or another one).

    Drops legal suffixes and "remote"/gender markers. Keeps region and team words, so
    "PM (US)" and "PM (Europe)" stay separate: a false match could drop the eligible variant.
    """
    c = _COMPANY_SUFFIXES.sub(" ", _slug(company))
    t = _TITLE_NOISE.sub(" ", _slug(title))
    return f"{' '.join(c.split())}|{' '.join(t.split())}"


def utc_now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat()


def iso_from_epoch(value: int | float | None) -> str | None:
    if value is None:
        return None
    return datetime.fromtimestamp(value, UTC).replace(microsecond=0).isoformat()


def iso_from_rfc822(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).astimezone(UTC).replace(microsecond=0).isoformat()
    except (TypeError, ValueError):
        return None


def iso_from_naive(value: str | None) -> str | None:
    """Parse an ISO timestamp with no zone (Remotive) and treat it as UTC."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC).replace(microsecond=0).isoformat()
