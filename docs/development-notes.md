# Development notes

Working notes for the README development record. Each entry: what changed, why,
and how it was checked.

## Stage 1: project skeleton

- **Built:** FastAPI backend; Gemini client and mock client behind one
  interface; prompt specifications (`app/prompts.py`); input/output page;
  "show what was sent" panel; three seeded demo failures; 8 tests.
- **Change during build: working feedback moved onto the Generate button.**
  In a browser check, clicking Generate low on the page left the "Working on
  it" message off-screen at the top of the answer panel, so the click seemed to
  do nothing. The message now also appears on the button, where attention
  already is (inattentional blindness and feedback timing, Lecture 04).
  Checked with a scripted browser run and screenshots.
- **Change during build: simulated delay in mock mode** (800 ms, configurable)
  so the waiting feedback behaves as it would with the live model.
- **Change during build: demo label clears when the text is edited**, so the
  interface never claims an edited text is still a demo case.

## Stage 2: recovery tools

- **Built:** five correction buttons with a hint box (hover or keyboard focus);
  free-text correction; `/api/revise`; word-level change detection and report
  computed by code (`app/diffing.py`); version history with authorship labels
  ("You chose this fix; the AI rewrote the answer"); Undo; 9 new tests.
- **Design decision: hints come from the prompt specification.** Each button's
  hint is served from the same `REVISIONS` entry as its prompt, so the preview
  cannot drift from what the button really asks for (feedforward, gulf of
  execution, L06).
- **Design decision: a hint box, not browser tooltips.** Native tooltips appear
  after a delay and not on keyboard focus; a fixed hint box is visible, readable
  and works with the keyboard.
- **Change during build: highlighting new words only by default.** The first
  version showed added and removed words inline. In a browser check of the
  "Simpler" rewrite, nearly every word was struck through or highlighted and the
  answer became hard to read (extraneous cognitive load, L05). The default now
  highlights only new words; removed words are an option. A "Mostly rewritten"
  note is added when 60% or more of the words were removed.
- **Design decision: Undo never deletes.** Undo returns to the version the
  current one was made from; every version stays in the history and can be
  reopened, so an undo can itself be undone (reversibility, L01).
- **Checked:** 17 tests pass; scripted browser walk-through of three scenarios
  (too technical → Simpler; Shorter makes it worse → Undo → own correction;
  missing point → Fix missing point) with screenshots.
