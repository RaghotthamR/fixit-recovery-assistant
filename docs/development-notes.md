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
