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
- **Implemented (interface):** step path (paste, get an answer, fix it);
  "How FixIt works" panel listing what it does, what it can't do, and
  shortcuts; Copy; keyboard shortcuts (Ctrl+Enter generate, Ctrl+Z undo outside
  text boxes); "This answer works for me" with a session summary (time to the
  final answer, fixes by method, undos, suggested fixes used) and a downloadable
  JSON log of counts and timings (no text is logged or stored); accessibility
  pass (visible focus, skip link, reduced motion, readable contrast).
- **Simulated:** three seeded demo failures (too technical, too long, missing
  the key point). An unchanged demo case always starts from its scripted bad
  answer, labelled "Seeded demo failure, not written by the model", in mock and
  live mode, so recovery can be shown on a known failure; with a key, every
  later step uses the real model. Mock mode also scripts the demo revisions
  and Auto-fix proposals.
- **Prompt tests:** `scripts/prompt_tests.py` runs 8 fixed cases (13
  code-checkable criteria) against the model and saves results in
  `docs/prompt-tests/`.

## Technology stack

- **Backend:** Python, FastAPI (serves the page and makes model calls, so the
  API key never reaches the browser).
- **Frontend:** plain HTML, CSS and JavaScript (no build step). Fonts:
  Atkinson Hyperlegible (interface; designed for low-vision legibility) and
  Source Serif 4 (reading text), loaded from Google Fonts; system fonts are
  used when offline.
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

Run the prompt test cases against the live model (needs your key in `.env`):

```bash
python -m scripts.prompt_tests            # each case once
python -m scripts.prompt_tests --repeat 3 # repeat to see run-to-run variation
```

## Storyboard frames

The storyboard screenshots in the report were captured by driving the running
app (live model) with a browser script:

```bash
pip install playwright
uvicorn app.main:app              # in one terminal
python -m scripts.capture_storyboards   # in a second terminal
```

Frames are saved to `docs/storyboards/frames/`; the composed storyboards are in
`docs/storyboards/`. The script uses the installed Microsoft Edge by default
(`--browser chrome` for Chrome).

## Project layout

```
app/        FastAPI backend: config, prompt specifications, model clients, mock data
static/     Web page: index.html, style.css, app.js
tests/      Unit and API tests (mock mode)
scripts/    Prompt test runner (live model)
docs/       Prompt log, development notes, prompt test results
```
