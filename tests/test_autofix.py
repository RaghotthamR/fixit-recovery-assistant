import json

import pytest
from fastapi.testclient import TestClient

from app.autofix import ProposalError, parse_proposal
from app.main import app
from app.mock_data import AUTOFIX, SAMPLES

client = TestClient(app)
TECH = next(s for s in SAMPLES if s["id"] == "too-technical")


def test_autofix_returns_proposal_without_running_it():
    res = client.post("/api/autofix", json={
        "source_text": TECH["source"], "request": TECH["request"],
        "current_answer": TECH["bad_output"],
    })
    assert res.status_code == 200
    data = res.json()
    p = data["proposal"]
    assert p["rewritten_request"] == AUTOFIX["too-technical"]["proposal"]["rewritten_request"]
    assert p["changes"] and p["assumptions"] and p["diagnosis"]
    # A proposal only: no new answer is produced by this endpoint.
    assert "output" not in data
    # The request diff is computed by code from old and new request.
    rebuilt = "".join(s["text"] for s in data["request_changes"]["segments"] if s["type"] != "del")
    assert rebuilt == p["rewritten_request"]


def test_approved_request_produces_new_answer_with_changes():
    new_request = AUTOFIX["too-technical"]["proposal"]["rewritten_request"]
    res = client.post("/api/generate", json={
        "source_text": TECH["source"], "request": new_request,
        "compare_to": TECH["bad_output"],
    })
    data = res.json()
    assert data["output"] == AUTOFIX["too-technical"]["output"]
    assert data["changes"]["report"]["words_before"] == len(TECH["bad_output"].split())


def test_generate_without_compare_has_no_changes():
    res = client.post("/api/generate", json={"source_text": TECH["source"],
                                             "request": TECH["request"]})
    assert res.json()["changes"] is None


def test_autofix_prompt_asks_for_changes_and_assumptions():
    res = client.post("/api/autofix", json={
        "source_text": "Text.", "current_answer": "Answer."})
    sent = res.json()["sent"]["user"]
    assert '"assumptions"' in sent and '"changes"' in sent
    assert "<current_answer>\nAnswer.\n</current_answer>" in sent


def test_parse_accepts_fenced_json():
    raw = "```json\n" + json.dumps({"diagnosis": "d", "rewritten_request": "r",
                                    "changes": ["c", " "], "assumptions": []}) + "\n```"
    p = parse_proposal(raw)
    assert p.rewritten_request == "r" and p.changes == ["c"]


@pytest.mark.parametrize("raw", [
    "not json at all",
    "[1, 2, 3]",
    json.dumps({"diagnosis": "d"}),                                   # missing request
    json.dumps({"diagnosis": "d", "rewritten_request": "   "}),       # blank request
    json.dumps({"diagnosis": "d", "rewritten_request": "x" * 501}),   # too long
])
def test_parse_rejects_unusable_proposals(raw):
    with pytest.raises(ProposalError):
        parse_proposal(raw)
