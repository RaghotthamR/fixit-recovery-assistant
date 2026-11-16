"""The suggested-fix checks are detectors: test both hits on known-bad answers
and false alarms on known-good answers (signal detection, L04)."""

import pytest
from fastapi.testclient import TestClient

from app.checks import requested_length, run_checks
from app.main import app
from app.mock_data import AUTOFIX, CANNED_REVISIONS, SAMPLES

client = TestClient(app)
BY_ID = {s["id"]: s for s in SAMPLES}

EXPECTED_HIT = {"too-technical": "simpler", "too-long": "shorter", "missing-point": "missing"}


@pytest.mark.parametrize("sample_id,button", EXPECTED_HIT.items())
def test_hit_on_each_seeded_failure(sample_id, button):
    s = BY_ID[sample_id]
    buttons = [f["button"] for f in run_checks(s["bad_output"], s["source"], s["request"])]
    assert buttons == [button]


GOOD = [
    (("too-technical", "simpler"), CANNED_REVISIONS[("too-technical", "simpler")]),
    (("too-long", "shorter"), CANNED_REVISIONS[("too-long", "shorter")]),
    (("missing-point", "missing"), CANNED_REVISIONS[("missing-point", "missing")]),
]


@pytest.mark.parametrize("key,answer", GOOD)
def test_no_false_alarm_on_good_revisions(key, answer):
    s = BY_ID[key[0]]
    assert run_checks(answer, s["source"], s["request"]) == []


@pytest.mark.parametrize("sample_id", AUTOFIX)
def test_no_false_alarm_on_good_autofix_answers(sample_id):
    s, fix = BY_ID[sample_id], AUTOFIX[sample_id]
    assert run_checks(fix["output"], s["source"], fix["proposal"]["rewritten_request"]) == []


def test_request_asking_to_leave_something_out_is_respected():
    s = BY_ID["too-long"]
    answer = AUTOFIX["too-long"]["output"]
    assert run_checks(answer, s["source"], "Summarise in 50 words; leave out examples.") == []


@pytest.mark.parametrize("request_text,expected", [
    ("Summarise this in about 80 words.", 80),
    ("Give me a 60-word summary.", 60),
    ("No more than 120 words please", 120),
    ("Summarise this.", None),
    ("Explain it for a 5 year old", None),
])
def test_requested_length(request_text, expected):
    assert requested_length(request_text) == expected


def test_generate_response_includes_checks():
    s = BY_ID["too-long"]
    data = client.post("/api/generate", json={"source_text": s["source"],
                                              "request": s["request"]}).json()
    assert [f["button"] for f in data["checks"]] == ["shorter"]


def test_mock_declines_correction_not_supported_by_source():
    s = BY_ID["too-technical"]
    data = client.post("/api/revise", json={
        "source_text": s["source"], "request": s["request"],
        "current_answer": s["bad_output"],
        "correction": "Add the author's name and when it was published",
    }).json()
    assert "does not mention" in data["output"]
    assert "“author”" in data["output"]
