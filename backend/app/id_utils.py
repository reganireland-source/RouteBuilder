"""ID normalisation and validation — shared by API endpoints and bulk import."""
import re

from fastapi import HTTPException

# Only letters, digits, hyphens, underscores.  No spaces, slashes, or URL-unsafe chars.
ID_SAFE_RE = re.compile(r'^[A-Za-z0-9_\-]+$')

ID_MAX_LEN: dict[str, int] = {
    "node":     15,
    "segment":  30,
    "system":   15,
    "capacity": 30,   # segment_id reference
    "coverage": 15,   # node_id reference
}


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
        bad = sorted({c for c in rid if not re.match(r'[A-Za-z0-9_\-]', c)})
        raise HTTPException(
            status_code=422,
            detail=(
                f"ID '{rid}' contains invalid characters {bad}. "
                "Only letters, digits, hyphens (-) and underscores (_) are allowed."
            ),
        )

    max_len = ID_MAX_LEN.get(entity, 30)
    if len(rid) > max_len:
        raise HTTPException(
            status_code=422,
            detail=f"ID '{rid}' is {len(rid)} characters; maximum for {entity} is {max_len}.",
        )

    return rid
