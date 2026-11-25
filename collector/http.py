"""Polite HTTP client: clear User-Agent, a delay between requests, optional disk cache."""

from __future__ import annotations

import hashlib
import time
from pathlib import Path
from typing import Protocol

import httpx


class Fetcher(Protocol):
    def get_text(self, url: str, params: dict | None = None) -> str: ...


class HttpClient:
    def __init__(
        self,
        user_agent: str,
        delay_seconds: float = 1.5,
        timeout_seconds: float = 30,
        cache_dir: Path | None = None,
    ) -> None:
        self._client = httpx.Client(
            headers={"User-Agent": user_agent},
            timeout=timeout_seconds,
            follow_redirects=True,
        )
        self._delay = delay_seconds
        self._cache_dir = cache_dir
        self._last_request = 0.0
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def _cache_path(self, url: str) -> Path | None:
        if not self._cache_dir:
            return None
        return self._cache_dir / hashlib.sha256(url.encode()).hexdigest()[:24]

    def get_text(self, url: str, params: dict | None = None) -> str:
        full_url = str(httpx.URL(url, params=params))
        cache_path = self._cache_path(full_url)
        if cache_path and cache_path.exists():
            return cache_path.read_text()

        wait = self._delay - (time.monotonic() - self._last_request)
        if wait > 0:
            time.sleep(wait)
        response = self._client.get(full_url)
        self._last_request = time.monotonic()
        response.raise_for_status()

        if cache_path:
            cache_path.write_text(response.text)
        return response.text

    def close(self) -> None:
        self._client.close()
