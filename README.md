# FixIt: an error-recovery assistant for AI summaries

> Work in progress (Assignment 2, Intelligent Interactive Systems). This README
> will be completed before submission.

FixIt helps non-expert users recover when an AI-generated summary or
explanation misses the mark.

## Project status

- **Implemented:** paste text, choose Summarise or Explain, get an AI answer;
  five correction buttons (Shorter, Simpler, Add example, More detail, Fix
  missing point) with a preview of what each will change; free-text correction;
  highlighting of new words (optionally removed words too) with a change report
  computed by code; version history with authorship labels and undo;
  **Auto-fix**, which proposes a rewritten request with its diagnosis, changes
  and assumptions, lets the person edit it, and runs nothing until they approve;
  **suggested fix**: checks run in code on every answer (length against the
  request, long words not in the source, requested points left out) and
  highlight a likely button, which the person can use or dismiss; decline
  behaviour when a correction asks for something the source does not contain;
  working indicator; "show what was sent to the model" panel.
- **Simulated:** mock mode with three seeded bad first answers (too technical,
  too long, missing the key point), scripted revisions and scripted Auto-fix
  proposals for the demo paths.
- **Not yet built:** live prompt test runner (fixed test cases against the
  real model).

## Technology stack

- **Backend:** Python, FastAPI (serves the page and makes model calls, so the
  API key never reaches the browser).
- **Frontend:** plain HTML, CSS and JavaScript (no build step).
- **Model:** Google Gemini via the `google-genai` SDK; model name set in `.env`
  (default `gemini-3.6-flash`).
- **Tests:** pytest, always in mock mode.

## Running it

Requires Python 3.10 or later.

```bash
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # Windows: copy .env.example .env
uvicorn app.main:app --reload
```

Open http://localhost:8000.

- **Without a key:** leave `GEMINI_API_KEY` empty in `.env`. The app runs in
  mock mode (badge in the top right) with canned responses.
- **With your own key:** create a free key in Google AI Studio and paste it into
  `.env` as `GEMINI_API_KEY=...`. Never commit `.env`.

Run the tests:

```bash
pytest
```

## Project layout

```
app/        FastAPI backend: config, prompt specifications, model clients, mock data
static/     Web page: index.html, style.css, app.js
tests/      API and prompt tests (mock mode)
docs/       Prompt log and development notes
```
