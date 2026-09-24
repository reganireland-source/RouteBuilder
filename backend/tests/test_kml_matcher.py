"""
Scoring how well a cable path's geometry and naming fit a candidate segment.

THE ONE PROPERTY THAT MUST HOLD is that auto-accept never fires on a wrong
answer. Everything else here is about how much work it saves; that is about
whether the feature can be trusted at all, because attaching one cable's
surveyed route to another produces a map that looks perfectly plausible and is
wrong. `test_auto_accept_is_never_wrong_*` run the matcher over a large sample
of the real network and assert zero.

Measured while choosing the rule, over 120 real segments:

                                     auto-accepted   wrong   sent to review
    score >= 90 and unambiguous           45           0          75
    (with useless filenames)                0          0         120
    geometry >= 65 and unambiguous        84           0          36
    (with useless filenames)               52          0          68

The first rule made a good filename effectively mandatory and sent a human work
the geometry had already answered. Both are equally safe; only one is useful.

THE HARD CASE IS PARALLEL CABLES. Two systems landing at the same pair of
stations — which is what diversity means, so it is common, not exotic — are
geometrically indistinguishable. The matcher does not guess between them: their
scores come out within AMBIGUOUS_MARGIN, whatever the top score is. Real
examples from the dataset: EQ_US_LA01/LA02, and SCC-N-SYD-FJI against
TABUA-FJI-SYD.

NOTE ON PathProposal/resolve_conflicts: these tests used to build a
`PathProposal` wrapper around `rank_candidates`' output, because a scored
review-table UI (`bulk_propose`/`bulk_commit`) needed `.auto_acceptable`/
`.ambiguous` as row properties and `resolve_conflicts` to catch two files in
one batch claiming the same segment. That table is gone (see
app/kml/flatten.py and api/kml.py's module docstrings — a branching cable
defeated its graph-anchored auto-split, and it was replaced by a human-driven
chop tool). `rank_candidates` itself is unchanged and still the right way to
score a path against a segment, so the auto-accept/ambiguity SAFETY tests are
kept, just computed with small local helpers instead of the retired
`PathProposal` class; the batch-conflict tests, which were purely about the
retired table, are not.

Run with:  pytest backend/tests/test_kml_matcher.py -v
"""
import json
import math
import random
from pathlib import Path

import pytest

from app.kml.matcher import (
    AMBIGUOUS_MARGIN,
    AUTO_ACCEPT_GEOMETRY,
    MAX_ENDPOINT_KM,
    Candidate,
    endpoint_score,
    name_score,
    rank_candidates,
    segment_tokens_for,
    tokenise,
)

DATA = Path(__file__).parent.parent / "data"


@pytest.fixture(scope="module")
def network():
    nodes = json.loads((DATA / "nodes.json").read_text())
    segments = json.loads((DATA / "segments.json").read_text())
    by_id = {n["id"]: n for n in nodes}
    seg_tokens = {s["id"]: segment_tokens_for(s, by_id) for s in segments}
    return segments, by_id, seg_tokens


def synth_path(segment, by_id, n: int = 300):
    """A believable KML for this segment: its real endpoints plus curvature."""
    a, z = by_id[segment["start_node_id"]], by_id[segment["end_node_id"]]
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append([
            a["lat"] + (z["lat"] - a["lat"]) * t + math.sin(t * 6) * 0.2,
            a["lng"] + (z["lng"] - a["lng"]) * t + math.cos(t * 5) * 0.2,
        ])
    out[0] = [a["lat"], a["lng"]]
    out[-1] = [z["lat"], z["lng"]]
    return out


def candidates_for(coords, tokens, network, system_hint=None) -> list[Candidate]:
    segments, by_id, seg_tokens = network
    return rank_candidates(coords, tokens, segments, by_id, seg_tokens, system_hint=system_hint)


def _ambiguous(candidates: list[Candidate]) -> bool:
    """Two candidates close enough that the top one is not clearly right —
    what PathProposal.ambiguous used to compute from the same data."""
    if len(candidates) < 2:
        return False
    return (candidates[0].score - candidates[1].score) < AMBIGUOUS_MARGIN


def _auto_acceptable(candidates: list[Candidate]) -> bool:
    """Geometry alone, plus nothing else close — what
    PathProposal.auto_acceptable used to compute from the same data."""
    if not candidates:
        return False
    return candidates[0].geometry_score >= AUTO_ACCEPT_GEOMETRY and not _ambiguous(candidates)


# ── The property that matters ────────────────────────────────────────────────

def test_auto_accept_is_never_wrong_with_good_filenames(network):
    segments, by_id, _ = network
    sample = random.Random(5).sample(segments, 120)
    wrong = []
    for seg in sample:
        c = candidates_for(synth_path(seg, by_id), tokenise(f"{seg['id']}.kmz", seg["name"]), network)
        if _auto_acceptable(c) and c[0].segment_id != seg["id"]:
            wrong.append((seg["id"], c[0].segment_id, c[0].score))
    assert wrong == [], f"auto-accepted the wrong segment: {wrong[:5]}"


def test_auto_accept_is_never_wrong_with_useless_filenames(network):
    """The realistic case: files called route_final_v3.kmz."""
    segments, by_id, _ = network
    sample = random.Random(11).sample(segments, 120)
    wrong = []
    for seg in sample:
        c = candidates_for(synth_path(seg, by_id), tokenise("route_final_v3.kmz"), network)
        if _auto_acceptable(c) and c[0].segment_id != seg["id"]:
            wrong.append((seg["id"], c[0].segment_id, c[0].score))
    assert wrong == [], f"auto-accepted the wrong segment: {wrong[:5]}"


def test_auto_accept_still_does_useful_work(network):
    """Safety is trivial to achieve by accepting nothing; this is the other half."""
    segments, by_id, _ = network
    sample = random.Random(5).sample(segments, 120)
    accepted = sum(
        1 for seg in sample
        if _auto_acceptable(candidates_for(synth_path(seg, by_id), tokenise(f"{seg['id']}.kmz", seg["name"]), network))
    )
    assert accepted >= 60, f"only {accepted}/120 auto-accepted — the rule has gone too conservative"


def test_the_right_segment_is_ranked_first_when_the_file_is_named_for_it(network):
    segments, by_id, _ = network
    sample = random.Random(5).sample(segments, 60)
    misses = [
        seg["id"] for seg in sample
        if candidates_for(synth_path(seg, by_id), tokenise(f"{seg['id']}.kmz", seg["name"]), network)[0].segment_id != seg["id"]
    ]
    assert misses == [], f"top candidate was wrong for {misses}"


# ── Geometry beats names ─────────────────────────────────────────────────────

def test_a_filename_cannot_override_the_geometry(network):
    """The failure this ordering exists to prevent: a file named for one cable
    but containing another's route must not be attached to the name."""
    segments, by_id, _ = network
    truth = next(s for s in segments if s["id"] == "PPC1-GUM-HAW")
    liar = "APG-TUC-TYO"
    c = candidates_for(synth_path(truth, by_id), tokenise(f"{liar}.kmz"), network)
    assert c[0].segment_id != liar
    assert c[0].geometry_score > c[0].name_score


def test_a_perfect_name_with_no_geometry_cannot_reach_auto_accept(network):
    """30 points of name is the ceiling without endpoints that fit."""
    segments, _, _ = network
    seg = segments[0]
    somewhere_else = [[-40.0, 10.0], [-41.0, 11.0]]      # South Atlantic
    c = candidates_for(somewhere_else, tokenise(f"{seg['id']}.kmz", seg["name"]), network)
    assert not _auto_acceptable(c)


# ── Ambiguity ────────────────────────────────────────────────────────────────

def test_parallel_cables_between_the_same_stations_are_flagged_not_guessed(network):
    """EQ_US_LA01 and EQ_US_LA02 share both endpoints. Neither may auto-accept."""
    segments, by_id, _ = network
    seg = next((s for s in segments if s["id"] == "EQ_US_LA01"), None)
    twin = next((s for s in segments if s["id"] == "EQ_US_LA02"), None)
    if not seg or not twin:
        pytest.skip("dataset no longer contains the EQ_US_LA parallel pair")
    c = candidates_for(synth_path(seg, by_id), tokenise("route_final_v3.kmz"), network)
    assert _ambiguous(c)
    assert not _auto_acceptable(c)


def test_a_single_candidate_is_not_ambiguous():
    assert not _ambiguous([])
    assert not _auto_acceptable([])


# ── system_hint: boost, not filter ──────────────────────────────────────────
#
# HAW1<->LAX1 is the worst real case in the dataset: five systems land at
# exactly the same two stations (AAG, SEAUS, SXNEXT, TABUA, UNITY), so a
# synthetic path between them is geometrically identical for all five and a
# filename carries no useful signal either. This is exactly the situation the
# hint exists for.

_HAW_LAX_SYSTEMS = ("AAG", "SEAUS", "SXNEXT", "TABUA", "UNITY")


def _haw_lax_segments(segments):
    return {s["system_id"]: s for s in segments if {s["start_node_id"], s["end_node_id"]} == {"HAW1", "LAX1"}}


def test_five_parallel_cables_are_ambiguous_without_a_hint(network):
    segments, by_id, _ = network
    by_system = _haw_lax_segments(segments)
    if len(by_system) < 5:
        pytest.skip("dataset no longer carries all five HAW1<->LAX1 systems")
    seg = by_system["UNITY"]
    c = candidates_for(synth_path(seg, by_id), tokenise("route.kmz"), network)
    assert _ambiguous(c)
    assert not _auto_acceptable(c)


def test_a_correct_hint_resolves_the_ambiguity(network):
    segments, by_id, _ = network
    by_system = _haw_lax_segments(segments)
    if len(by_system) < 5:
        pytest.skip("dataset no longer carries all five HAW1<->LAX1 systems")
    seg = by_system["UNITY"]
    coords = synth_path(seg, by_id)
    c = candidates_for(coords, tokenise("route.kmz"), network, system_hint="UNITY")
    assert c[0].segment_id == seg["id"]
    assert not _ambiguous(c)
    assert _auto_acceptable(c)


def test_a_wrong_hint_can_shift_the_ranking_but_never_the_geometry_score(network):
    """The hint may prefer a different one of the five look-alikes — the whole
    point is that geometry alone cannot tell them apart — but it must never
    change what the geometry itself says, and it must never manufacture a fit
    where the geometry does not have one."""
    segments, by_id, _ = network
    by_system = _haw_lax_segments(segments)
    if len(by_system) < 5:
        pytest.skip("dataset no longer carries all five HAW1<->LAX1 systems")
    seg = by_system["UNITY"]
    coords = synth_path(seg, by_id)
    tokens = tokenise("route.kmz")

    unhinted = candidates_for(coords, tokens, network)
    hinted = candidates_for(coords, tokens, network, system_hint="TABUA")

    geo_before = {c.segment_id: c.geometry_score for c in unhinted}
    geo_after = {c.segment_id: c.geometry_score for c in hinted}
    assert geo_before == geo_after, "system_hint changed a geometry_score — it must only touch naming"

    assert hinted[0].segment_id == by_system["TABUA"]["id"]


def test_a_hint_cannot_pull_a_geometrically_unrelated_segment_above_auto_accept(network):
    """A wrong hint pointing at a system whose segment the path does not fit at
    all — not one of the look-alikes, something geographically elsewhere —
    must not be able to reach auto-accept. NAME_WEIGHT is the ceiling a hint
    can add, and AUTO_ACCEPT_GEOMETRY gates on geometry_score alone."""
    segments, by_id, _ = network
    truth = next(s for s in segments if s["id"] == "PPC1-GUM-HAW")
    elsewhere_system = next(
        s["system_id"] for s in segments
        if s["system_id"] not in (truth["system_id"],) and {s["start_node_id"], s["end_node_id"]} != {truth["start_node_id"], truth["end_node_id"]}
    )
    coords = synth_path(truth, by_id)
    candidates = candidates_for(coords, tokenise("route.kmz"), network, system_hint=elsewhere_system)
    hinted_wrong = next((c for c in candidates if c.system_id == elsewhere_system), None)
    if hinted_wrong is not None:
        assert hinted_wrong.geometry_score < AUTO_ACCEPT_GEOMETRY
        assert candidates[0].segment_id != hinted_wrong.segment_id or not _auto_acceptable(candidates)


# ── Endpoint scoring ─────────────────────────────────────────────────────────

def test_both_ends_must_fit_not_just_one():
    """Averaging would let a path starting at the right station but ending 400km
    away score 0.5 and outrank a correct, slightly loose match."""
    a, z = (1.29, 103.85), (22.30, 114.20)
    half_right = [[1.29, 103.85], [40.0, 150.0]]
    score, _, _, _ = endpoint_score(half_right, a, z)
    assert score == 0.0


def test_orientation_is_detected():
    a, z = (1.29, 103.85), (22.30, 114.20)
    forward = [[1.29, 103.85], [10.0, 108.0], [22.30, 114.20]]
    s1, _, _, rev1 = endpoint_score(forward, a, z)
    s2, _, _, rev2 = endpoint_score(list(reversed(forward)), a, z)
    assert s1 == s2 == 1.0
    assert rev1 is False and rev2 is True


def test_a_gap_beyond_the_maximum_scores_nothing():
    a, z = (0.0, 0.0), (0.0, 1.0)
    far = [[40.0, 40.0], [41.0, 41.0]]
    score, _, _, _ = endpoint_score(far, a, z)
    assert score == 0.0


def test_a_small_gap_is_still_a_perfect_fit():
    """A KML stopping at the beach manhole must not be penalised."""
    a, z = (1.29, 103.85), (22.30, 114.20)
    near = [[1.30, 103.86], [22.29, 114.19]]
    score, _, _, _ = endpoint_score(near, a, z)
    assert score == 1.0


# ── Tokenising ───────────────────────────────────────────────────────────────

def test_tokenise_splits_on_punctuation_and_drops_noise():
    assert tokenise("AJC-GUM-TYO_final_v3.kmz") == {"ajc", "gum", "tyo"}


def test_tokenise_drops_bare_numbers_that_match_everything():
    assert "2024" not in tokenise("export_2024.kmz")


def test_name_score_is_zero_when_nothing_is_known():
    assert name_score(set(), {"ajc"}) == 0.0
    assert name_score({"ajc"}, set()) == 0.0


def test_constants_are_internally_consistent():
    assert AUTO_ACCEPT_GEOMETRY <= 70.0
    assert MAX_ENDPOINT_KM > 0
