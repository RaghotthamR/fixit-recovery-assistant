"""FixIt backend: serves the web page and the model-call API.

Run with:  uvicorn app.main:app --reload
"""

import time
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config
from .llm import LLMError, get_client
from .autofix import ProposalError, parse_proposal
from .checks import run_checks
from .diffing import diff_words
from .mock_data import public_samples
from .prompts import (
    REVISIONS,
    build_autofix_context,
    build_context,
    build_revision_context,
)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_SOURCE_CHARS = 12000

app = FastAPI(title="FixIt")
client = get_client()


class GenerateRequest(BaseModel):
    source_text: str = Field(..., min_length=1, max_length=MAX_SOURCE_CHARS)
    mode: Literal["summarise", "explain"] = "summarise"
    request: str = Field("", max_length=500)


class GenerateWithCompare(GenerateRequest):
    # Optional: the answer this one replaces, so the change report can be built.
    compare_to: str = Field("", max_length=MAX_SOURCE_CHARS)


class AutofixRequest(GenerateRequest):
    current_answer: str = Field(..., min_length=1, max_length=MAX_SOURCE_CHARS)


class ReviseRequest(GenerateRequest):
    current_answer: str = Field(..., min_length=1, max_length=MAX_SOURCE_CHARS)
    # Exactly one of: a fixed correction button, or a free-text correction.
    button: Literal["shorter", "simpler", "example", "detail", "missing"] | None = None
    correction: str = Field("", max_length=500)


@app.get("/api/health")
def health():
    """Tells the page which mode is running, so the interface can say so."""
    return {"status": "ok", "mock": config.MOCK_MODE, "model": client.name}


@app.get("/api/controls")
def controls():
    """Button labels and hover hints, served from the same specification the
    prompts use, so what the hint promises matches what the prompt asks for."""
    return [{"id": k, "label": v["label"], "hint": v["hint"]} for k, v in REVISIONS.items()]


@app.get("/api/samples")
def samples():
    return public_samples()


@app.post("/api/generate")
def generate(body: GenerateWithCompare):
    if not body.source_text.strip():
        raise HTTPException(status_code=422, detail="Paste some text first.")
    context = build_context(body.mode, body.source_text, body.request)
    started = time.perf_counter()
    try:
        output = client.generate(context, source_text=body.source_text,
                                 request=body.request)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return {
        "changes": diff_words(body.compare_to, output) if body.compare_to.strip() else None,
        # Suggested fixes, computed in code; shown as suggestions only (L03).
        "checks": run_checks(output, body.source_text, body.request),
        "output": output,
        "mode": body.mode,
        "model": client.name,
        "mock": config.MOCK_MODE,
        "elapsed_ms": elapsed_ms,
        # A record of exactly what was sent (Lecture 10: record what was sent).
        "sent": context,
    }


@app.post("/api/revise")
def revise(body: ReviseRequest):
    has_correction = bool(body.correction.strip())
    if bool(body.button) == has_correction:
        raise HTTPException(
            status_code=422,
            detail="Choose one correction button or type a correction.",
        )
    context = build_revision_context(
        body.mode, body.source_text, body.request, body.current_answer,
        button=body.button, correction=body.correction,
    )
    revision = {"button": body.button, "correction": body.correction,
                "current": body.current_answer}
    started = time.perf_counter()
    try:
        output = client.generate(context, source_text=body.source_text, revision=revision)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return {
        "output": output,
        "action": context["action"],
        "model": client.name,
        "mock": config.MOCK_MODE,
        "elapsed_ms": elapsed_ms,
        # Computed by code from the two texts, not reported by the model.
        "changes": diff_words(body.current_answer, output),
        "checks": run_checks(output, body.source_text, body.request),
        "sent": context,
    }


@app.post("/api/autofix")
def autofix(body: AutofixRequest):
    """Return a proposed rewritten request. Nothing is run here: the page shows
    the proposal and only runs it after the person approves (L12)."""
    context = build_autofix_context(body.mode, body.source_text, body.request,
                                    body.current_answer)
    started = time.perf_counter()
    try:
        raw = client.generate(context, source_text=body.source_text,
                              request=body.request, json_mode=True)
        proposal = parse_proposal(raw)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except ProposalError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"{exc} Nothing was changed. Try again, or use a quick fix.",
        ) from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return {
        "proposal": proposal.model_dump(),
        # Which words of the request changed, computed by code (L12).
        "request_changes": diff_words(body.request.strip(), proposal.rewritten_request),
        "model": client.name,
        "mock": config.MOCK_MODE,
        "elapsed_ms": elapsed_ms,
        "sent": context,
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
