"""Checking the model's Auto-fix proposal before the person sees it.

The model is asked for JSON in a fixed shape. This module checks that shape in
code. A schema guarantees shape, not truth (Lecture 09): a well-formed proposal
can still be a bad rewrite, which is why the person reviews it before it runs.
A malformed proposal is a caught error, never shown as if it were valid.
"""

import json
import re

from pydantic import BaseModel, Field, ValidationError, field_validator

MAX_REQUEST_CHARS = 500


class ProposalError(Exception):
    pass


class Proposal(BaseModel):
    diagnosis: str = Field(..., min_length=1, max_length=400)
    rewritten_request: str = Field(..., min_length=1, max_length=MAX_REQUEST_CHARS)
    changes: list[str] = Field(default_factory=list, max_length=10)
    assumptions: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("diagnosis", "rewritten_request")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("changes", "assumptions")
    @classmethod
    def clean_items(cls, items: list[str]) -> list[str]:
        return [i.strip() for i in items if isinstance(i, str) and i.strip()]


_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


def parse_proposal(raw: str) -> Proposal:
    """Parse and validate the model's reply; raise ProposalError if unusable."""
    text = _FENCE.sub("", raw.strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProposalError("Auto-fix did not return a readable proposal.") from exc
    if not isinstance(data, dict):
        raise ProposalError("Auto-fix returned a proposal in the wrong shape.")
    try:
        return Proposal(**data)
    except ValidationError as exc:
        raise ProposalError("Auto-fix returned an incomplete proposal.") from exc
