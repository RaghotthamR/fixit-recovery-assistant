"""Seeded demo failures: an unchanged demo case starts from its scripted bad
answer, labelled as such, without calling the model, in any mode."""

from fastapi.testclient import TestClient

import app.main as main
from app.mock_data import SAMPLES
from scripts.prompt_tests import cases

client = TestClient(main.app)
TECH = SAMPLES[0]


class ExplodingClient:
    name = "live-model"

    def generate(self, *args, **kwargs):
        raise AssertionError("the model must not be called for a seeded demo answer")


def test_seeded_answer_does_not_call_the_model(monkeypatch):
    monkeypatch.setattr(main, "client", ExplodingClient())
    data = client.post("/api/generate", json={
        "source_text": TECH["source"], "request": TECH["request"]}).json()
    assert data["seeded"] is True
    assert data["output"] == TECH["bad_output"]


def test_changed_request_is_not_seeded():
    data = client.post("/api/generate", json={
        "source_text": TECH["source"], "request": "Explain it simply."}).json()
    assert data["seeded"] is False


def test_prompt_test_cases_are_well_formed():
    for case in cases():
        context = case["call"]()
        assert context["system"] and context["user"]
        assert case["criteria"]


def test_busy_errors_are_retried_then_reported_clearly(monkeypatch):
    from app import llm

    calls = {"n": 0}

    class FakeModels:
        def generate_content(self, **kwargs):
            calls["n"] += 1
            raise RuntimeError("503 UNAVAILABLE. This model is currently experiencing high demand.")

    g = llm.GeminiClient.__new__(llm.GeminiClient)
    from google import genai
    g._genai, g.name = genai, "test-model"
    g._client = type("C", (), {"models": FakeModels()})()
    monkeypatch.setattr(llm, "RETRY_DELAYS", (0, 0))
    try:
        g.generate({"system": "s", "user": "u"})
    except llm.LLMError as exc:
        assert "busy" in str(exc)
    assert calls["n"] == 3


def test_bad_key_is_not_retried(monkeypatch):
    from app import llm

    calls = {"n": 0}

    class FakeModels:
        def generate_content(self, **kwargs):
            calls["n"] += 1
            raise RuntimeError("400 API key not valid")

    g = llm.GeminiClient.__new__(llm.GeminiClient)
    from google import genai
    g._genai, g.name = genai, "test-model"
    g._client = type("C", (), {"models": FakeModels()})()
    try:
        g.generate({"system": "s", "user": "u"})
    except llm.LLMError as exc:
        assert "key" in str(exc)
    assert calls["n"] == 1
