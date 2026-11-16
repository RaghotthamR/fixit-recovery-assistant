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
from .diffing import diff_words
from .mock_data import public_samples
from .prompts import REVISIONS, build_context, build_revision_context

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_SOURCE_CHARS = 12000

app = FastAPI(title="FixIt")
client = get_client()


class GenerateRequest(BaseModel):
    source_text: str = Field(..., min_length=1, max_length=MAX_SOURCE_CHARS)
    mode: Literal["summarise", "explain"] = "summarise"
    request: str = Field("", max_length=500)


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
def generate(body: GenerateRequest):
    if not body.source_text.strip():
        raise HTTPException(status_code=422, detail="Paste some text first.")
    context = build_context(body.mode, body.source_text, body.request)
    started = time.perf_counter()
    try:
        output = client.generate(context, source_text=body.source_text)
    except LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    elapsed_ms = round((time.perf_counter() - started) * 1000)
    return {
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
        "sent": context,
    }


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
