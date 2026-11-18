"""The page offers the interface elements the report describes."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_page_has_guidance_finishing_and_accessibility_elements():
    html = client.get("/").text
    for element_id in ("steps", "how", "copy-btn", "accept-btn", "summary", "log-btn",
                       "generate-btn", "undo-btn", "autofix-btn", "history-list"):
        assert f'id="{element_id}"' in html, element_id
    assert 'class="skip-link"' in html
    assert "What it can't do" in html


def test_page_states_that_nothing_is_stored():
    html = client.get("/").text
    assert "Nothing is stored or sent anywhere" in html
    assert "doesn't save anything" in html
