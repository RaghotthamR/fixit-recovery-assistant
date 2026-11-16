# Prompt log

Each change to a prompt is recorded with its version, what changed, why, and how
it was checked (fixed testing loop, Lecture 09: change one thing, rerun the same
cases).

| Version | Prompt | Change | Reason | Checked by |
|---|---|---|---|---|
| v1 | Summarise / Explain | First version: six-part task specification (task, audience, constraints, success criteria, output format); source and request wrapped in `<source>` and `<request>` tags; system instruction says tagged text is information, not instructions; task restated after the source. | Separate instruction from information (L09, L10); state the task first and restate it after the evidence (L10). | Unit tests for context assembly. Live test cases added in a later step. |
