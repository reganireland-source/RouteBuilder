"""
Deriving storable geometry from a KML path: simplification, length, and which
way round the file was drawn.

THE SIMPLIFIER HAS A BUDGET AND MUST USE IT. An earlier version stepped the RDP
tolerance up by 1.8x and took the first result under the budget. On a 2,600 km
test route that returned TEN points out of an allowed 150, because the step that
crossed the threshold overshot it fifteenfold — every curve in the cable was
flattened and the drawn line sat up to 333 km from the real one. The binary
search that replaced it lands at 137 points with 0.85 km of deviation, which is
0.16 of a pixel at world zoom. `test_budget_is_actually_used` is what stops that
regressing: a simplifier that returns a valid-looking handful of points fails no
other check.

Run with:  pytest backend/tests/test_kml_geometry.py -v
"""
import math
import random

from app.kml.geometry import (
    DISPLAY_POINT_BUDGET,
    ENDPOINT_WARN_KM,
    build_geometry,
    endpoint_gaps,
    path_length_km,
    simplify_path,
)

SIN = (1.29, 103.85)
HKG = (22.30, 114.20)


def dense_route(n: int = 5200, seed: int = 7) -> list[list[float]]:
    """A survey-grade looking path: many points, real curvature, slight jitter."""
    rng = random.Random(seed)
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append([
            SIN[0] + (HKG[0] - SIN[0]) * t + math.sin(t * 9) * 0.35 + rng.uniform(-0.004, 0.004),
            SIN[1] + (HKG[1] - SIN[1]) * t + math.cos(t * 7) * 0.30 + rng.uniform(-0.004, 0.004),
        ])
    return out


def max_deviation_km(full: list[list[float]], disp: list[list[float]]) -> float:
    """Worst perpendicular distance from a full point to the SIMPLIFIED LINE.

    Distance to the nearest simplified VERTEX is the wrong measure and flatters
    nothing — it reported 65 km for a path that is actually within 0.85 km of
    the drawn line, because a point halfway between two vertices is far from
    both and yet sits exactly on the segment joining them.
    """
    KM_PER_DEG = 111.32

    def pt_seg(p, s, e):
        latr = math.radians(p[0])
        px, py = p[1] * math.cos(latr), p[0]
        ax, ay = s[1] * math.cos(latr), s[0]
        bx, by = e[1] * math.cos(latr), e[0]
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay) * KM_PER_DEG
        t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy)) * KM_PER_DEG

    return max(
        min(pt_seg(p, disp[i], disp[i + 1]) for i in range(len(disp) - 1))
        for p in full[::5]
    )


# ── Simplification ───────────────────────────────────────────────────────────

def test_budget_is_respected():
    assert len(simplify_path(dense_route(), 150)) <= 150


def test_budget_is_actually_used():
    """The regression guard. Ten points is under budget and catastrophically wrong."""
    got = len(simplify_path(dense_route(), 150))
    assert got >= 150 * 0.8, f"simplifier returned only {got} of an allowed 150 points"


def test_simplified_line_stays_within_a_pixel_of_the_real_one():
    """0.85 km is 0.16 px at world zoom, where a 2,600 km cable spans ~500 px."""
    full = dense_route()
    disp = simplify_path(full, DISPLAY_POINT_BUDGET)
    assert max_deviation_km(full, disp) < 3.0


def test_a_sparse_path_is_returned_untouched():
    """A hand-drawn 4-point route must not be cut just because dense ones are."""
    sparse = [[1.29, 103.85], [5.0, 106.0], [12.0, 110.0], [22.3, 114.2]]
    assert simplify_path(sparse, 150) == sparse


def test_endpoints_always_survive_simplification():
    """Everything downstream measures the ends against the segment's nodes."""
    full = dense_route()
    disp = simplify_path(full, 40)
    assert disp[0] == full[0]
    assert disp[-1] == full[-1]


def test_simplify_never_returns_fewer_than_two_points():
    assert len(simplify_path(dense_route(), 2)) >= 2


# ── Length ───────────────────────────────────────────────────────────────────

def test_length_is_measured_on_the_full_path_not_the_display_path():
    """Simplifying cuts corners, so the display path is measurably shorter —
    22% on the dense fixture. Storing that number would understate every cable."""
    full = dense_route()
    g = build_geometry(full, SIN, HKG)
    assert abs(g.length_km - path_length_km(full)) < 0.01
    assert path_length_km(g.display_path) < g.length_km


def test_a_straight_two_point_path_measures_its_great_circle():
    g = build_geometry([[SIN[0], SIN[1]], [HKG[0], HKG[1]]], SIN, HKG)
    assert 2300 < g.length_km < 2700   # SIN->HKG is ~2,570 km


# ── Orientation ──────────────────────────────────────────────────────────────

def test_a_path_drawn_z_to_a_is_detected_and_turned_round():
    """A KML records a path, not a direction. Measuring only the stored order
    would report a perfectly good file as thousands of km out of place."""
    forward = dense_route()
    g = build_geometry(list(reversed(forward)), SIN, HKG)
    assert g.reversed_to_match is True
    assert g.a_end_gap_km is not None and g.a_end_gap_km < 60
    # Stored A->Z like every other segment, so no consumer has to know.
    assert g.full_path[0][0] == forward[0][0]


def test_a_path_drawn_a_to_z_is_left_alone():
    g = build_geometry(dense_route(), SIN, HKG)
    assert g.reversed_to_match is False


def test_gaps_are_none_when_the_nodes_are_unknown():
    g = build_geometry(dense_route(), None, None)
    assert g.a_end_gap_km is None and g.z_end_gap_km is None
    assert g.needs_review is False


def test_endpoint_gaps_picks_the_better_of_the_two_orientations():
    path = [[1.29, 103.85], [10.0, 108.0], [22.30, 114.20]]
    fwd = endpoint_gaps(path, SIN, HKG)
    rev = endpoint_gaps(list(reversed(path)), SIN, HKG)
    assert fwd[2] is False and rev[2] is True
    assert fwd[0] < 1 and rev[0] < 1


# ── Review flag ──────────────────────────────────────────────────────────────

def test_a_path_far_from_its_nodes_is_flagged_for_review():
    """Wrong-segment files look exactly like right ones until you measure."""
    g = build_geometry([[35.6, 139.7], [40.0, 145.0]], SIN, HKG)   # Japan, not SIN-HKG
    assert g.needs_review is True


def test_a_small_gap_is_normal_and_not_flagged():
    """A KML legitimately stops at the beach manhole, not inside the station."""
    near_sin = [SIN[0] + 0.02, SIN[1] + 0.02]     # ~3 km off
    near_hkg = [HKG[0] - 0.02, HKG[1] - 0.02]
    g = build_geometry([near_sin, [10.0, 108.0], near_hkg], SIN, HKG)
    assert g.a_end_gap_km < ENDPOINT_WARN_KM
    assert g.needs_review is False
