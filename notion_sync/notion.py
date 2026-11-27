"""Minimal, read-only Notion API client: query one data source, read a page's text."""

from __future__ import annotations

import os
import time
from typing import Any

import httpx

API = "https://api.notion.com/v1"
VERSION = "2025-09-03"
TEXT_BLOCKS = {
    "paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item",
    "numbered_list_item", "quote", "callout", "toggle", "to_do",
}  # fmt: skip


class Notion:
    def __init__(self, token: str, transport: httpx.BaseTransport | None = None) -> None:
        self.client = httpx.Client(
            base_url=API,
            headers={
                "Authorization": f"Bearer {token}",
                "Notion-Version": VERSION,
                "Content-Type": "application/json",
            },
            timeout=30,
            transport=transport,
        )
        self.backoff = (2.0, 5.0)

    @classmethod
    def from_env(cls) -> Notion | None:
        token = os.environ.get("NOTION_TOKEN")
        return cls(token) if token else None

    def _request(self, method: str, path: str, **kw: Any) -> dict[str, Any]:
        for wait in (*self.backoff, None):
            r = self.client.request(method, path, **kw)
            if (r.status_code == 429 or r.status_code >= 500) and wait is not None:
                time.sleep(float(r.headers.get("Retry-After", wait)))
                continue
            r.raise_for_status()
            return r.json()
        raise AssertionError("unreachable")

    def pages(self, data_source_id: str, since: str | None = None) -> list[dict[str, Any]]:
        """Pages in the data source (created on or after `since`), oldest first."""
        out: list[dict[str, Any]] = []
        body: dict[str, Any] = {
            "page_size": 100,
            "sorts": [{"timestamp": "created_time", "direction": "ascending"}],
        }
        if since:
            body["filter"] = {"timestamp": "created_time", "created_time": {"on_or_after": since}}
        while True:
            data = self._request("POST", f"/data_sources/{data_source_id}/query", json=body)
            out += [p for p in data.get("results", []) if not p.get("in_trash")]
            if not data.get("has_more"):
                return out
            body["start_cursor"] = data["next_cursor"]

    def body_text(self, page_id: str, limit_chars: int = 20000) -> str:
        """Plain text of the page's top-level blocks (where a pasted description goes)."""
        lines: list[str] = []
        params: dict[str, Any] = {"page_size": 100}
        while True:
            data = self._request("GET", f"/blocks/{page_id}/children", params=params)
            for b in data.get("results", []):
                kind = b.get("type")
                if kind in TEXT_BLOCKS:
                    text = "".join(t.get("plain_text", "") for t in b[kind].get("rich_text", []))
                    if kind in {"bulleted_list_item", "numbered_list_item"} and text:
                        text = f"- {text}"
                    lines.append(text)
            if not data.get("has_more") or sum(map(len, lines)) > limit_chars:
                return "\n".join(lines).strip()[:limit_chars]
            params["start_cursor"] = data["next_cursor"]

    def close(self) -> None:
        self.client.close()
