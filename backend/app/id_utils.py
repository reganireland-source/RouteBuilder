"""
ID normalisation and validation — shared by API endpoints and bulk import.

WHAT IS ALLOWED, AND WHY IT IS A SHORT LIST. An id is not a label: it goes into
URL paths (/api/nodes/{id}), into CSV columns, into drawio and Visio XML, and it
is what every segment stores to point at its endpoints. So the rule is an
ALLOW-list — characters have to be shown to be safe everywhere before they are
let in, rather than merely not known to break anything.

`&` is allowed because real station codes carry it and it is safe in all four
places: it is an RFC 3986 sub-delim, so legal in a path segment; the exporters
escape it (escXml/escVml); and CSV does not treat it specially. The frontend
percent-encodes ids into URLs regardless, so nothing here depends on a raw `&`
surviving a path.

Still refused, and these are the ones that matter:
  /   splits the URL path, so the id would address a different route entirely
  ?   starts the query string, and everything after it stops being the id
  #   starts the fragment, which never reaches the server at all
  %   begins a percent-escape, so the id would not survive a decode round trip
  space and control characters, which break CSV and are invisible in a UI

Adding another character is a one-line change here plus a line in the
description below. Doing it anywhere else means two rules that disagree.
"""
import re

from fastapi import HTTPException

#: The single source of truth for what an id may contain. See the module
#: docstring for why each one is in or out.
ID_SAFE_CHARS = r'A-Za-z0-9_\-&'
ID_SAFE_RE = re.compile(rf'^[{ID_SAFE_CHARS}]+$')
#: Shown to the user whenever an id is rejected. Kept next to the pattern so the
#: message and the rule can never drift apart.
ID_RULE_DESCRIPTION = (
    "Only letters, digits, hyphens (-), underscores (_) and ampersands (&) are allowed."
)

#: Per-entity maximum id length, keyed by the same `entity` string callers
#: pass to normalize_id()/_validate_id(). "capacity" and "coverage" are not
#: separate ID spaces — they store an id that must already exist as a
#: segment_id / node_id respectively — so their limits just mirror those.
#: An entity not listed here falls back to 30 (see normalize_id's default).
ID_MAX_LEN: dict[str, int] = {
    "node":     15,
    "segment":  30,
    "system":   15,
    "capacity": 30,   # segment_id reference
    "coverage": 15,   # node_id reference
}


def invalid_chars(rid: str) -> list[str]:
    """The characters in `rid` that the rule rejects, sorted, for an error message."""
    return sorted({c for c in rid if not re.match(rf'[{ID_SAFE_CHARS}]', c)})


def normalize_id(raw: str, entity: str) -> str:
    """
    Validate and normalize an entity ID for API use.

    Returns the uppercased, stripped ID on success.
    Raises HTTPException 422 on any blocking violation.
    Rules are identical to those applied during bulk import validation.
    """
    rid = raw.strip().upper()

    if not rid:
        raise HTTPException(status_code=422, detail=f"{entity.capitalize()} id cannot be blank")

    if not ID_SAFE_RE.match(rid):
        raise HTTPException(
            status_code=422,
            detail=f"ID '{rid}' contains invalid characters {invalid_chars(rid)}. {ID_RULE_DESCRIPTION}",
        )

    max_len = ID_MAX_LEN.get(entity, 30)
    if len(rid) > max_len:
        raise HTTPException(
            status_code=422,
            detail=f"ID '{rid}' is {len(rid)} characters; maximum for {entity} is {max_len}.",
        )

    return rid
