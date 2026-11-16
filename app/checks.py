"""Suggested fix: simple checks, run in code, on every answer.

These checks give the system a signal beyond the person's explicit commands
(the first property of an intelligent interactive system, L02): it compares
the answer with the request and the source, infers a likely problem, and
*suggests* a fix. It never applies one. The person decides (mixed initiative:
ask rather than act, L03), and every finding can be dismissed.

Each check is a detector with a criterion (signal detection, L04). The
criteria below are deliberately cautious: a false alarm on a good answer costs
attention and trust (the cry-wolf effect), so a check fires only on clear
evidence, and says what that evidence is. They are heuristics, not
measurements of quality, and the interface words them as "may".
"""

import re

_WORD = re.compile(r"[A-Za-z][A-Za-z'-]*")
_NUMBER_WORDS = re.compile(
    r"(?:about|around|roughly|under|below|at most|no more than|max(?:imum)?|"
    r"in)?\s*(\d{2,4})\s*(?:-|\s)?\s*words?\b",
    re.IGNORECASE,
)

STOPWORDS = set("""
a about above after again against all also an and any are as at be because been
before being below between both but by can could did do does doing down during
each few for from further had has have having he her here hers him his how i if
in into is it its itself just me more most my no nor not now of off on once only
or other our out over own same she should so some such than that the their them
then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your yours
give make write summarise summarize summary explain explanation please words
word student students first-year year first reader readers about around roughly
short shorter long longer simple simpler plain text reading this that it
""".split())

# Criteria (cautious by design; see module note).
LENGTH_OVER = 1.3        # answer more than 30% over the requested length
LENGTH_UNDER = 0.6       # answer under 60% of the requested length
MIN_UNFAMILIAR = 4       # at least 4 long words that are not in the source...
UNFAMILIAR_SHARE = 0.10  # ...making up at least 10% of the answer's words
MISSING_WEIGHT = 0.20    # an uncovered point must be >= 20% of the source's content
LONG_WORD = 8            # letters
MAX_LISTED = 4


def _words(text: str) -> list[str]:
    return [w.lower().strip("'-").removesuffix("'s") for w in _WORD.findall(text)]


def _content_words(text: str) -> set[str]:
    return {w for w in _words(text) if len(w) >= 4 and w not in STOPWORDS}


def _stem(word: str) -> str:
    return word[:6]


def _sentences(text: str) -> list[str]:
    return [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]


def requested_length(request: str) -> int | None:
    """Find a word target such as 'about 80 words' or 'a 60-word summary'."""
    match = _NUMBER_WORDS.search(request)
    if not match:
        return None
    n = int(match.group(1))
    return n if 10 <= n <= 2000 else None


def unfamiliar_terms(answer: str, source: str) -> list[str]:
    """Long words in the answer that do not appear in the source (by stem).

    Such words may be jargon the reader was not given, or content the source
    does not support (extrinsic hallucination, L08).
    """
    source_stems = {_stem(w) for w in _words(source)}
    seen, found = set(), []
    for w in _words(answer):
        if len(w) >= LONG_WORD and _stem(w) not in source_stems and w not in seen:
            seen.add(w)
            found.append(w)
    return found


_EXCLUSION = re.compile(
    r"\b(?:leave out|leaving out|without|avoid|exclude|excluding|skip|not|no|don't|do not)\b[^.;,]*",
    re.IGNORECASE,
)


def _wanted_words(request: str) -> set[str]:
    """Content words the request asks for, ignoring what it asks to leave out
    (e.g. 'leave out examples' must not make 'examples' a wanted point)."""
    return _content_words(_EXCLUSION.sub(" ", request))


def uncovered_requested_points(answer: str, source: str, request: str) -> list[str]:
    """Substantial source sentences that the answer barely touches and that
    share a word with what the request asks for."""
    answer_stems = {_stem(w) for w in _content_words(answer)}
    request_stems = {_stem(w) for w in _wanted_words(request)}
    source_stems = {_stem(w) for w in _content_words(source)}
    missing = []
    for sentence in _sentences(source):
        stems = {_stem(w) for w in _content_words(sentence)}
        if not stems or not source_stems:
            continue
        coverage = len(stems & answer_stems) / len(stems)
        weight = len(stems) / len(source_stems)
        if coverage < 0.25 and weight >= MISSING_WEIGHT and stems & request_stems:
            missing.append(sentence)
    return missing


def run_checks(answer: str, source: str, request: str) -> list[dict]:
    findings = []
    words = len(_words(answer))

    target = requested_length(request)
    if target:
        if words > target * LENGTH_OVER:
            findings.append({
                "id": "too-long",
                "button": "shorter",
                "message": f"This answer is {words} words; your request asked for "
                           f"about {target}.",
            })
        elif words < target * LENGTH_UNDER:
            findings.append({
                "id": "too-short",
                "button": "detail",
                "message": f"This answer is {words} words; your request asked for "
                           f"about {target}.",
            })

    terms = unfamiliar_terms(answer, source)
    if len(terms) >= MIN_UNFAMILIAR and words and len(terms) / words >= UNFAMILIAR_SHARE:
        listed = ", ".join(terms[:MAX_LISTED])
        findings.append({
            "id": "unfamiliar-terms",
            "button": "simpler",
            "message": f"This answer uses {len(terms)} long words that are not in "
                       f"your text and may be hard to follow: {listed}.",
        })

    missing = uncovered_requested_points(answer, source, request)
    if missing:
        snippet = missing[0] if len(missing[0]) <= 120 else missing[0][:117] + "…"
        findings.append({
            "id": "missing-point",
            "button": "missing",
            "message": f"Your request mentions something the answer may leave out. "
                       f"Your text says: “{snippet}”",
        })
    return findings
