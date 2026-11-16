"""Word-level change detection between two versions of an answer.

The change report is computed here, by code, from the two texts. It is not the
model's own account of what it changed: "the return value is a fact; the
model's summary is a claim" (Lecture 12), and reliability is a property of the
system, not the model (Lecture 08). Highlighting the changes also counters
change blindness when the answer is re-rendered (Lecture 04).
"""

import re
from difflib import SequenceMatcher

_TOKEN = re.compile(r"\s+|[^\s]+")
_SENTENCE_END = re.compile(r"[.!?](?:\s|$)")


def _tokens(text: str) -> list[str]:
    return _TOKEN.findall(text)


def _word_count(tokens: list[str]) -> int:
    return sum(1 for t in tokens if not t.isspace())


def _sentence_count(text: str) -> int:
    text = text.strip()
    if not text:
        return 0
    return max(1, len(_SENTENCE_END.findall(text + " ")))


def diff_words(old: str, new: str) -> dict:
    """Return highlight segments and a change report for old -> new."""
    a, b = _tokens(old), _tokens(new)
    matcher = SequenceMatcher(None, a, b, autojunk=False)
    segments: list[dict] = []
    added = removed = 0

    def push(kind: str, toks: list[str]):
        if not toks:
            return
        text = "".join(toks)
        if segments and segments[-1]["type"] == kind:
            segments[-1]["text"] += text
        else:
            segments.append({"type": kind, "text": text})

    for op, i1, i2, j1, j2 in matcher.get_opcodes():
        if op == "equal":
            push("same", b[j1:j2])
        else:
            if op in ("delete", "replace"):
                push("del", a[i1:i2])
                removed += _word_count(a[i1:i2])
            if op in ("insert", "replace"):
                push("add", b[j1:j2])
                added += _word_count(b[j1:j2])

    words_before, words_after = _word_count(a), _word_count(b)
    return {
        "segments": segments,
        "report": {
            "words_before": words_before,
            "words_after": words_after,
            "words_added": added,
            "words_removed": removed,
            "sentences_before": _sentence_count(old),
            "sentences_after": _sentence_count(new),
            "unchanged": added == 0 and removed == 0,
        },
    }
