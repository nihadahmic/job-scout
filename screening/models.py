"""What Gemini must return for each job, validated strictly."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


class JobVerdict(BaseModel):
    id: str
    tier: Literal["1", "2", "3", "drop"]
    fit: int = Field(ge=0, le=100)
    fit_reason: str = Field(min_length=3, max_length=400)
    eligibility_note: str = Field(default="", max_length=300)
    drop_reason: str = Field(default="", max_length=200)
    # Why a job was dropped. Only eligibility categories hide a job (see screen.apply);
    # "requirement" (a hard requirement he lacks) keeps it visible with a low fit.
    drop_category: Literal["", "work_permit", "location", "onsite", "industry", "requirement"] = ""

    @field_validator("tier", mode="before")
    @classmethod
    def _tier_as_text(cls, v):
        return str(v).strip().lower()

    @field_validator("fit_reason", "eligibility_note", "drop_reason")
    @classmethod
    def _tidy(cls, v: str) -> str:
        return " ".join(v.replace("—", ", ").replace("–", "-").split())


class BatchVerdict(BaseModel):
    results: list[JobVerdict]


# Gemini's response schema (OpenAPI subset), matching the models above.
RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "results": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "id": {"type": "STRING"},
                    "tier": {"type": "STRING", "enum": ["1", "2", "3", "drop"]},
                    "fit": {"type": "INTEGER"},
                    "fit_reason": {"type": "STRING"},
                    "eligibility_note": {"type": "STRING"},
                    "drop_reason": {"type": "STRING"},
                    "drop_category": {
                        "type": "STRING",
                        "enum": [
                            "",
                            "work_permit",
                            "location",
                            "onsite",
                            "industry",
                            "requirement",
                        ],
                    },
                },
                "required": [
                    "id",
                    "tier",
                    "fit",
                    "fit_reason",
                    "eligibility_note",
                    "drop_reason",
                    "drop_category",
                ],
            },
        }
    },
    "required": ["results"],
}
