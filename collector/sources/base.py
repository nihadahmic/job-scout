"""Common interface every source module implements."""

from __future__ import annotations

from typing import Any, Protocol

from collector.http import Fetcher
from collector.models import Job, RawJob


class Source(Protocol):
    name: str

    def __init__(self, client: Fetcher, config: dict[str, Any]) -> None: ...

    def fetch(self) -> list[RawJob]:
        """Pull listings from the source. Network happens here and only here."""
        ...

    def normalize(self, raw: RawJob) -> Job:
        """Map one raw listing to the shared Job schema. Pure, no network."""
        ...
