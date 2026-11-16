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
from .mock_data import public_samples
from .prompts import build_context

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
MAX_SOURCE_CHARS = 12000

app = FastAPI(title="FixIt")
client = get_client()


class GenerateRequest(BaseModel):
    source_text: str = Field(..., min_length=1, max_length=MAX_SOURCE_CHARS)
    mode: Literal["summarise", "explain"] = "summarise"
    request: str = Field("", max_length=500)


@app.get("/api/health")
def health():
    """Tells the page which mode is running, so the interface can say so."""
    return {"status": "ok", "mock": config.MOCK_MODE, "model": client.name}


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


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC_DIR / "index.html")
