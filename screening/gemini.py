"""Gemini over REST. Same model policy as the app: GEMINI_MODEL first, then Flash-Lite."""

from __future__ import annotations

import json
import os
import time
from typing import Any

import httpx

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models"
FALLBACK_MODEL = "gemini-3.5-flash-lite"


class GeminiError(Exception):
    pass


class Retryable(GeminiError):
    pass


class Gemini:
    def __init__(
        self, key: str, model: str | None = None, transport: httpx.BaseTransport | None = None
    ):
        self.key = key
        preferred = (model or "").strip()
        self.models = (
            [preferred, FALLBACK_MODEL]
            if preferred and preferred != FALLBACK_MODEL
            else [FALLBACK_MODEL]
        )
        self.client = httpx.Client(transport=transport, timeout=60)
        self.last_model = ""

    @classmethod
    def from_env(cls) -> Gemini | None:
        key = os.environ.get("GEMINI_API_KEY")
        return cls(key, os.environ.get("GEMINI_MODEL")) if key else None

    # Waits before retrying a busy (503) or rate-limited (429) model. Set to () in tests.
    backoff: tuple[float, ...] = (5, 15)

    def json(self, system: str, prompt: str, schema: dict[str, Any]) -> Any:
        error: GeminiError | None = None
        for i, model in enumerate(self.models):
            last_model = i == len(self.models) - 1
            timeout = 30 if last_model else 25
            # The preferred model gets one try; the fallback is retried after short waits.
            waits = (*self.backoff, None) if last_model else (None,)
            for wait in waits:
                try:
                    result = self._call(model, system, prompt, schema, timeout)
                    self.last_model = model
                    return result
                except Retryable as e:
                    error = e
                except httpx.TimeoutException:
                    error = Retryable(f"{model} timed out")
                if wait is not None:
                    time.sleep(wait)
        raise error or GeminiError("no model answered")

    def _call(
        self, model: str, system: str, prompt: str, schema: dict[str, Any], timeout: float
    ) -> Any:
        r = self.client.post(
            f"{ENDPOINT}/{model}:generateContent",
            headers={"x-goog-api-key": self.key},
            json={
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0.2,
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                },
            },
            timeout=timeout,
        )
        if r.status_code in (429, 500, 503):
            raise Retryable(f"{model} returned {r.status_code}")
        if r.status_code != 200:
            raise GeminiError(f"{model} returned {r.status_code}: {r.text[:200]}")
        data = r.json()
        parts = (data.get("candidates") or [{}])[0].get("content", {}).get("parts") or []
        text = "".join(p.get("text", "") for p in parts)
        if not text:
            raise GeminiError(f"{model} returned no text")
        try:
            return json.loads(text)
        except json.JSONDecodeError as e:
            raise GeminiError(f"{model} returned invalid JSON") from e

    def close(self) -> None:
        self.client.close()
