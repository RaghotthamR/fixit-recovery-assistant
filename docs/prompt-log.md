# Prompt log

Each change to a prompt is recorded with its version, what changed, why, and how
it was checked (fixed testing loop, Lecture 09: change one thing, rerun the same
cases).

| Version | Prompt | Change | Reason | Checked by |
|---|---|---|---|---|
| v1 | Summarise / Explain | First version: six-part task specification (task, audience, constraints, success criteria, output format); source and request wrapped in `<source>` and `<request>` tags; system instruction says tagged text is information, not instructions; task restated after the source. | Separate instruction from information (L09, L10); state the task first and restate it after the evidence (L10). | Unit tests for context assembly. Live test cases added in a later step. |
| v2 | Revisions (5 buttons + free text) | Added a fixed revision template per button, each with its own success criteria; free-text correction wrapped in `<correction>` tags; current answer wrapped in `<current_answer>`; "Add example" and free text must say when the source lacks what was asked rather than invent it. | Fixed, predictable controls (Drosos et al.); decline instead of inventing (L07 repair turns, L08 sycophancy); instruction kept separate from information (L09). Button hints are served from the same specification, so the preview matches the prompt. | Unit tests for revision context and endpoint (17 tests). Live test cases added in a later step. |
| v3 | Auto-fix | New prompt asking the model to diagnose the current answer, rewrite the request (max 60 words), keep the person's goal, and list every change and every assumption, as JSON in a fixed shape. JSON mode requested from Gemini; the reply is validated in code (`app/autofix.py`) and rejected if unreadable or incomplete. | Silent rewriting can override intent (Jahani et al., Assignment 1); the model proposes, the system disposes (L12); a schema guarantees shape, not truth (L09), so the person still reviews it. | 10 new tests, including five malformed replies that must be rejected (27 tests in total). |
