"""
Scoring how well a cable path's geometry and naming fit a candidate segment.

Originally the whole engine behind a scored bulk-import review table; that
table is gone (see api/kml.py's module docstring and kml/flatten.py — a
branching cable like AJC defeats a graph-anchored auto-split, which is what
replaced it with a human-driven chop tool). `rank_candidates` and its helpers
are kept here as a library: nothing in this codebase calls them today, but
the scoring itself — geometry outweighs names, described below — is still
the right way to answer "which segment does this path look like," and is
cheap to keep for a future "guess the system" hint rather than being deleted
and rewritten if that need comes back. AUTO_ACCEPT_GEOMETRY/AMBIGUOUS_MARGIN
remain meaningful thresholds even without a table gating on them.

GEOMETRY OUTWEIGHS NAMES, and that ordering is the whole design. A filename is a
claim ("AJC-GUM-TYO.kmz"); endpoint positions are evidence. Files get renamed,
copied from a neighbouring route as a starting point, or exported with whatever
the last engineer called them, so a confident name on the wrong geometry is
exactly the failure that would quietly attach one cable's route to another. When
the two disagree, geometry wins and the name becomes a tiebreak.

    geometry  0..70   how close the path's two ends sit to the segment's two
                      nodes, in either orientation (a KML records a path, not a
                      direction). Falls away with distance and reaches zero at
                      MAX_ENDPOINT_KM.
    name      0..30   tokens shared between the file/placemark/folder names and
                      the segment's id, name and system.

A path with no geometric fit scores at most 30 however well its name matches.

WHAT THIS DELIBERATELY DOES NOT DO: pick. `rank_candidates` returns ranked
candidates with the numbers behind them; the caller decides. Where two cables
run between the same pair of landing stations — which is common, that is what
diversity means — the top two scores will be close together, and that is
information, not a problem to be hidden by returning only the winner.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

from ..hazards.proximity import haversine_km

#: Past this an endpoint contributes nothing — the path is simply somewhere else.
MAX_ENDPOINT_KM = 300.0
#: Inside this an endpoint is treated as a perfect fit. A KML routinely stops at
#: the beach manhole rather than inside the station.
PERFECT_ENDPOINT_KM = 5.0

GEOMETRY_WEIGHT = 70.0
NAME_WEIGHT = 30.0

#: Geometry a match must reach (out of GEOMETRY_WEIGHT) before it may be
#: accepted in bulk without opening the row. Measured over 120 real segments:
#: this rule auto-accepted 84 correctly with good filenames and 52 with useless
#: ones, and NEVER accepted a wrong answer in either case.
#:
#: The first rule required a combined score of 90, which meant a good filename
#: was effectively mandatory — it cleared only 45 of the same 120 and none at
#: all when filenames carried no information, sending work to a human that the
#: geometry had already answered. Gating on geometry and requiring the match to
#: be unambiguous is both safer and far more useful: a name can be wrong, and
#: the ambiguity guard is what actually prevents the mistakes.
AUTO_ACCEPT_GEOMETRY = 65.0
#: Below this it is not offered as a candidate at all.
MIN_CANDIDATE_SCORE = 20.0
#: How many ranked alternatives to return per path.
MAX_CANDIDATES = 5
#: When the runner-up is this close, the choice is genuinely ambiguous and the
#: row is flagged however high the top score is.
AMBIGUOUS_MARGIN = 8.0

#: Split names into comparable tokens: "AJC-GUM-TYO_final_v3" -> ajc gum tyo final v3
_TOKEN_RE = re.compile(r"[^A-Za-z0-9]+")
#: Noise that appears in almost every exported filename and identifies nothing.
_STOPWORDS = frozenset({
    "kml", "kmz", "doc", "final", "draft", "copy", "new", "old", "rev", "v",
    "route", "cable", "segment", "seg", "path", "rpl", "as", "built", "asbuilt",
    "system", "trunk", "main", "the", "of", "and", "to", "from", "export",
})


def tokenise(*values: Optional[str]) -> set[str]:
    """Lowercased, punctuation-split, stopword- and digit-noise-stripped tokens."""
    out: set[str] = set()
    for v in values:
        if not v:
            continue
        for tok in _TOKEN_RE.split(v.lower()):
            if len(tok) < 2 or tok in _STOPWORDS:
                continue
            # A bare number ("3", "2024") matches everything and means nothing.
            if tok.isdigit():
                continue
            # A version marker — v3, rev2, draft1. Same argument: it says which
            # copy of the file this is, never which cable it holds. Only a
            # STOPWORD prefix is stripped this way, so genuine node codes of the
            # same shape (GUM1, SIN3, TYO2) survive untouched.
            head = tok.rstrip("0123456789")
            if head != tok and head in _STOPWORDS:
                continue
            out.add(tok)
    return out


def endpoint_score(
    coords: list[list[float]],
    a_node: Optional[tuple[float, float]],
    z_node: Optional[tuple[float, float]],
) -> tuple[float, float, float, bool]:
    """
    Return (score 0..1, a_gap_km, z_gap_km, reversed).

    Both orientations are measured and the better one wins, because a KML's
    direction is an artefact of who drew it, not a property of the cable.
    """
    if not coords or a_node is None or z_node is None:
        return 0.0, float("inf"), float("inf"), False

    head = (coords[0][0], coords[0][1])
    tail = (coords[-1][0], coords[-1][1])
    forward = (haversine_km(head, a_node), haversine_km(tail, z_node))
    backward = (haversine_km(tail, a_node), haversine_km(head, z_node))

    if sum(backward) < sum(forward):
        a_gap, z_gap, flipped = backward[0], backward[1], True
    else:
        a_gap, z_gap, flipped = forward[0], forward[1], False

    def one(gap: float) -> float:
        if gap <= PERFECT_ENDPOINT_KM:
            return 1.0
        if gap >= MAX_ENDPOINT_KM:
            return 0.0
        # Linear decay between the two. Deliberately not exponential: the point
        # is to rank candidates against each other, and a curve that collapses
        # quickly makes every imperfect fit look equally bad.
        return 1.0 - (gap - PERFECT_ENDPOINT_KM) / (MAX_ENDPOINT_KM - PERFECT_ENDPOINT_KM)

    # BOTH ends must fit, so the weaker one sets the score. Averaging would let
    # a path that happens to start at the right station but end 400 km away
    # score 0.5 and outrank a correct but slightly loose match.
    return min(one(a_gap), one(z_gap)), a_gap, z_gap, flipped


def name_score(path_tokens: set[str], segment_tokens: set[str]) -> float:
    """Share of the segment's identifying tokens present in the file's names."""
    if not segment_tokens or not path_tokens:
        return 0.0
    return len(path_tokens & segment_tokens) / len(segment_tokens)


@dataclass
class Candidate:
    segment_id: str
    segment_name: str
    system_id: str
    score: float
    geometry_score: float
    name_score: float
    a_end_gap_km: float
    z_end_gap_km: float
    reversed: bool
    #: This segment already has an active KML; accepting makes a new version.
    already_linked: bool = False


def segment_tokens_for(segment: dict, nodes_by_id: dict[str, dict]) -> set[str]:
    """Everything about a segment a filename might plausibly mention."""
    a = nodes_by_id.get(segment.get("start_node_id") or "")
    z = nodes_by_id.get(segment.get("end_node_id") or "")
    return tokenise(
        segment.get("id"), segment.get("name"), segment.get("system_id"),
        segment.get("start_node_id"), segment.get("end_node_id"),
        (a or {}).get("name"), (a or {}).get("city"),
        (z or {}).get("name"), (z or {}).get("city"),
    )


def rank_candidates(
    coords: list[list[float]],
    path_tokens: set[str],
    segments: list[dict],
    nodes_by_id: dict[str, dict],
    seg_tokens: dict[str, set[str]],
    linked_ids: Optional[set[str]] = None,
    system_hint: Optional[str] = None,
) -> list[Candidate]:
    """
    Score one path against every segment and return the best few.

    `system_hint` is what the importer believes this file belongs to — a
    cable-system id volunteered at upload time, or the system a "sync from
    Submarine Cable Map" fetch was run against. It is a BOOST, not a filter: a
    matching system_id raises a candidate's name component to its maximum
    (NAME_WEIGHT, same ceiling as a perfect filename match), which is enough to
    separate look-alike candidates — five cables between the same two stations
    are geometrically identical and a hint is the only thing that can tell them
    apart — but it never touches geometry_score, and AUTO_ACCEPT_GEOMETRY gates
    on geometry_score alone. So a WRONG hint can raise a right-system candidate
    above a wrong-system one when both already fit the geometry, but it can
    never pull a match onto a segment the path does not fit, and it can never by
    itself push a bad-geometry candidate over the auto-accept line.
    """
    linked_ids = linked_ids or set()
    scored: list[Candidate] = []

    for seg in segments:
        a = nodes_by_id.get(seg.get("start_node_id") or "")
        z = nodes_by_id.get(seg.get("end_node_id") or "")
        a_pt = (float(a["lat"]), float(a["lng"])) if a else None
        z_pt = (float(z["lat"]), float(z["lng"])) if z else None

        geo, a_gap, z_gap, flipped = endpoint_score(coords, a_pt, z_pt)
        nm = name_score(path_tokens, seg_tokens.get(seg["id"], set()))
        if system_hint and seg.get("system_id") == system_hint:
            nm = max(nm, 1.0)
        total = geo * GEOMETRY_WEIGHT + nm * NAME_WEIGHT
        if total < MIN_CANDIDATE_SCORE:
            continue

        scored.append(Candidate(
            segment_id=seg["id"],
            segment_name=seg.get("name") or seg["id"],
            system_id=seg.get("system_id") or "",
            score=round(total, 1),
            geometry_score=round(geo * GEOMETRY_WEIGHT, 1),
            name_score=round(nm * NAME_WEIGHT, 1),
            a_end_gap_km=round(a_gap, 2) if a_gap != float("inf") else -1.0,
            z_end_gap_km=round(z_gap, 2) if z_gap != float("inf") else -1.0,
            reversed=flipped,
            already_linked=seg["id"] in linked_ids,
        ))

    scored.sort(key=lambda c: c.score, reverse=True)
    return scored[:MAX_CANDIDATES]


