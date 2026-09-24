"""
What an entity id is allowed to contain — the rule in app/id_utils.py.

This is an ALLOW-list, so the tests that matter are the NEGATIVE ones. Adding a
character to the pattern is a one-line change and is easy to do casually; these
pin the handful that must never be let in, so a future widening has to face them
rather than sail past.

Live motivation: node `KTN&` (Kuantan Cable Landing Station, APCN2) is a real
station code and was rejected with 422. `&` was added to the allow-list because
it is safe in all four places an id travels — URL path segment (RFC 3986
sub-delim, and the frontend percent-encodes regardless), drawio XML and Visio
VML (both escaped by escXml/escVml), and CSV (no special meaning). The refused
set below is the reason that argument had to be made per-character rather than
by loosening the pattern.

The second half pins that bulk import and the API agree. They used to duplicate
both the character class and the wording, which is exactly how a CSV comes to
accept an id the form refuses.

Run with:  pytest backend/tests/test_id_rules.py -v
"""
import pytest
from fastapi import HTTPException

from app.api.bulk import _validate_id
from app.id_utils import ID_RULE_DESCRIPTION, normalize_id


# ── Accepted ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("raw", [
    "KTN&",             # the case that prompted this — ampersand in a station code
    "&",                # degenerate but legal
    "A&B&C",            # repeated
    "SIN3",             # the ordinary shape
    "TERRESTRIAL_AU03", # underscore
    "EAC-SIN-HKG",      # hyphen
    "AJC-SYD&MEL-GUM",  # all three punctuation marks at once
])
def test_accepted(raw):
    assert normalize_id(raw, "node" if len(raw) <= 15 else "segment") == raw.upper()


def test_ampersand_id_is_uppercased_and_trimmed_like_any_other():
    assert normalize_id("  ktn&  ", "node") == "KTN&"


# ── Refused, and these are the ones that matter ───────────────────────────────

@pytest.mark.parametrize("raw,why", [
    ("KTN/X",  "splits the URL path, addressing a different route"),
    ("KTN?X",  "starts the query string"),
    ("KTN#X",  "starts the fragment, which never reaches the server"),
    ("KTN%41", "begins a percent-escape, so it would not survive a decode"),
    ("KTN X",  "space breaks CSV and is invisible in a UI"),
    ("KTN\tX", "control character"),
    ("KTN.X",  "not shown to be safe anywhere, so not allowed in"),
    ("KTN+X",  "means space in some decoders"),
])
def test_refused(raw, why):
    with pytest.raises(HTTPException) as exc:
        normalize_id(raw, "node")
    assert exc.value.status_code == 422, why


def test_blank_is_refused_before_the_pattern_runs():
    with pytest.raises(HTTPException) as exc:
        normalize_id("   ", "node")
    assert "blank" in str(exc.value.detail).lower()


def test_error_names_the_offending_character_and_states_the_rule():
    with pytest.raises(HTTPException) as exc:
        normalize_id("KTN/X", "node")
    detail = str(exc.value.detail)
    assert "'/'" in detail, "the user needs to know WHICH character was wrong"
    assert ID_RULE_DESCRIPTION in detail


def test_length_limit_still_applies_to_an_id_containing_an_ampersand():
    with pytest.raises(HTTPException) as exc:
        normalize_id("A&" * 8, "node")   # 16 chars, node limit is 15
    assert "maximum for node is 15" in str(exc.value.detail)


# ── Bulk import applies the same rule, with the same wording ──────────────────

def test_bulk_accepts_what_the_api_accepts():
    normalized, errors, _ = _validate_id("ktn&", "node", row_num=2)
    assert errors == []
    assert normalized == "KTN&"


@pytest.mark.parametrize("raw", ["KTN/X", "KTN?X", "KTN#X", "KTN%41", "KTN X"])
def test_bulk_refuses_what_the_api_refuses(raw):
    _, errors, _ = _validate_id(raw, "node", row_num=2)
    assert errors, f"bulk import accepted {raw!r}, which the API refuses"


def test_bulk_and_api_explain_the_rule_in_the_same_words():
    _, errors, _ = _validate_id("KTN/X", "node", row_num=2)
    assert ID_RULE_DESCRIPTION in errors[0]["message"]
