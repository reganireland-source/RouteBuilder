from __future__ import annotations
import math
import itertools
import networkx as nx
from .models import (
    CableSegment, InterconnectRule, DiversityType,
    Route, RouteSegmentDetail, RouteResponse, SegmentCapacity
)

_OWNERSHIP_SCORE: dict[str, int] = {
    "owned": 3, "iru": 3, "consortium": 2,
    "integrated_lit_lease": 1, "offnet_resell": 0,
}

_OPTIMISE_SORT: dict[str, tuple[int, bool]] = {
    # (metrics-tuple index, reverse=True means descending)
    "hops":      (0, False),
    "distance":  (1, False), "length":   (1, False),
    "latency":   (2, False),
    "margin":    (3, False), "cost":     (3, False),
    "ownership": (4, True),
    "capacity":  (5, True),
}
from .graph import validate_interconnect_rules, path_to_segment_ids


def _path_cost(G: nx.Graph, node_path: list[str]) -> float:
    return sum(
        G[node_path[i]][node_path[i + 1]]["cost_weight"]
        for i in range(len(node_path) - 1)
    )


def _build_route(
    G: nx.Graph,
    node_path: list[str],
    segments_by_id: dict[str, CableSegment],
    route_id: str,
    diversity_group: int,
) -> Route:
    seg_ids = path_to_segment_ids(G, node_path)
    seg_details = []
    total_cost = 0.0
    total_length = 0.0
    reliability = 1.0

    total_latency = 0.0

    for sid in seg_ids:
        seg = segments_by_id[sid]
        seg_details.append(RouteSegmentDetail(
            segment_id=seg.id,
            system_id=seg.system_id,
            start_node_id=seg.start_node_id,
            end_node_id=seg.end_node_id,
            type=seg.type,
            length_km=seg.length_km,
            reliability=seg.reliability,
            cost_weight=seg.cost_weight,
            ownership=seg.ownership,
            latency=seg.latency,
        ))
        total_cost += seg.cost_weight
        total_length += seg.length_km
        reliability *= seg.reliability
        total_latency += seg.latency or 0.0

    return Route(
        id=route_id,
        nodes=node_path,
        segments=seg_details,
        total_cost=round(total_cost, 2),
        total_length_km=round(total_length, 1),
        total_latency=round(total_latency, 2),
        end_to_end_reliability=round(reliability, 6),
        diversity_group=diversity_group,
    )


def _apply_waypoints(
    G: nx.Graph,
    start: str,
    end: str,
    waypoints: list[str],
    rules: list[InterconnectRule],
    avoid_edges: set[tuple[str, str]],
    k: int = 5,
) -> list[list[str]]:
    """Find paths through mandatory waypoints in order."""
    checkpoints = [start] + waypoints + [end]
    # Remove consecutive duplicates (e.g. when start == first waypoint)
    checkpoints = [v for i, v in enumerate(checkpoints) if i == 0 or v != checkpoints[i - 1]]
    segment_candidates: list[list[list[str]]] = []

    working_G = G.copy()
    for u, v in avoid_edges:
        if working_G.has_edge(u, v):
            working_G.remove_edge(u, v)

    for i in range(len(checkpoints) - 1):
        src, dst = checkpoints[i], checkpoints[i + 1]
        try:
            paths = itertools.islice(nx.shortest_simple_paths(working_G, src, dst, weight="length_km"), k * 3)
            valid = [p for p in paths if validate_interconnect_rules(working_G, p, rules)]
            segment_candidates.append(valid[:k])
        except nx.NetworkXNoPath:
            return []

    # Combine sub-paths (stitch them together, deduplicating junction nodes).
    # Reject any merge where a sub-path reuses an edge already in the base path,
    # which would cause the same segment to appear twice in the route.
    combined: list[list[str]] = [[]]
    for sub_paths in segment_candidates:
        new_combined = []
        for base in combined:
            base_edges = {
                (min(base[j], base[j + 1]), max(base[j], base[j + 1]))
                for j in range(len(base) - 1)
            }
            for sub in sub_paths:
                if base and base[-1] != sub[0]:
                    continue
                if any(
                    (min(sub[j], sub[j + 1]), max(sub[j], sub[j + 1])) in base_edges
                    for j in range(len(sub) - 1)
                ):
                    continue
                merged = base + sub[1:] if base else sub
                new_combined.append(merged)
        combined = new_combined[:k]

    return combined


def _select_candidates(
    candidates: list[list[str]],
    k: int,
    working_G: nx.Graph,
    segments_by_id: dict[str, CableSegment],
    capacities_by_id: dict[str, SegmentCapacity],
    optimise_for: str | None,
    outage_segment_ids: "set[str] | None" = None,
) -> list[list[str]]:
    """Pick k routes using multi-dimension pooling or a single-dimension sort."""
    if len(candidates) <= k and optimise_for != "outages":
        return candidates

    # Precompute metrics once: (hops, length_km, latency, cost, ownership_avg, cap_min)
    metrics: list[tuple[float, ...]] = []
    all_seg_ids: list[list[str]] = []
    for path in candidates:
        seg_ids = path_to_segment_ids(working_G, path)
        all_seg_ids.append(seg_ids)
        segs = [segments_by_id[sid] for sid in seg_ids if sid in segments_by_id]
        n = len(segs) or 1
        cap_vals = [capacities_by_id[sid].available_capacity_t for sid in seg_ids if sid in capacities_by_id]
        metrics.append((
            float(len(segs)),
            sum(s.length_km for s in segs),
            sum(s.latency or 0.0 for s in segs),
            sum(s.cost_weight for s in segs),
            sum(_OWNERSHIP_SCORE.get(str(s.ownership), 0) for s in segs) / n,
            min(cap_vals) if cap_vals else 0.0,
        ))

    # Outage filter: keep only routes with no active outage on any segment
    if optimise_for == "outages" and outage_segment_ids:
        clean = [i for i, sids in enumerate(all_seg_ids) if not any(sid in outage_segment_ids for sid in sids)]
        work = clean if clean else list(range(len(candidates)))
        cost_order = sorted(work, key=lambda i: metrics[i][3])
        return [candidates[i] for i in cost_order[:k]]

    if len(candidates) <= k:
        return candidates

    # Single-dimension override
    if optimise_for in _OPTIMISE_SORT:
        col, rev = _OPTIMISE_SORT[optimise_for]
        order = sorted(range(len(candidates)), key=lambda i: metrics[i][col], reverse=rev)
        return [candidates[i] for i in order[:k]]

    # Multi-dimension pooling: build one ranked list per dimension
    dims: list[list[int]] = [
        sorted(range(len(candidates)), key=lambda i: metrics[i][0]),        # hops asc
        sorted(range(len(candidates)), key=lambda i: metrics[i][1]),        # length asc
        sorted(range(len(candidates)), key=lambda i: metrics[i][2]),        # latency asc
        sorted(range(len(candidates)), key=lambda i: metrics[i][3]),        # cost/margin asc
        sorted(range(len(candidates)), key=lambda i: -metrics[i][4]),       # ownership desc
    ]
    if any(m[5] > 0 for m in metrics):
        dims.append(sorted(range(len(candidates)), key=lambda i: -metrics[i][5]))  # capacity desc

    per_dim = max(3, math.ceil(k / len(dims)) + 1)
    seen: set[int] = set()
    pool: list[int] = []
    for ranked in dims:
        for idx in ranked[:per_dim]:
            if idx not in seen:
                seen.add(idx)
                pool.append(idx)
                if len(pool) >= k:
                    return [candidates[i] for i in pool]

    # Fill any remaining slots with cost-ordered candidates
    for idx in dims[3]:
        if idx not in seen:
            seen.add(idx)
            pool.append(idx)
            if len(pool) >= k:
                break

    return [candidates[i] for i in pool[:k]]


def _make_diverse_graph(
    working_G: nx.Graph,
    primary_path: list[str],
    segments_by_id: "dict[str, CableSegment]",
    diversity: DiversityType,
) -> nx.Graph:
    """Return a copy of working_G with the primary path's relevant edges/nodes removed."""
    seg_ids = path_to_segment_ids(working_G, primary_path)
    segs = [(sid, segments_by_id[sid]) for sid in seg_ids if sid in segments_by_id]

    # Walk from each end to find the leading terrestrial run
    origin_terr: set[str] = set()
    for sid, seg in segs:
        if seg.type == "terrestrial":
            origin_terr.add(sid)
        else:
            break

    dest_terr: set[str] = set()
    for sid, seg in reversed(segs):
        if seg.type == "terrestrial":
            dest_terr.add(sid)
        else:
            break

    diverse_G = working_G.copy()

    for sid, seg in segs:
        remove = (
            diversity in (DiversityType.full, DiversityType.full_nodes)
            or (seg.type == "wet" and diversity == DiversityType.wet)
            or (diversity == DiversityType.terrestrial_origin and sid in origin_terr)
            or (diversity == DiversityType.terrestrial_destination and sid in dest_terr)
            or (diversity == DiversityType.terrestrial_both and sid in (origin_terr | dest_terr))
        )
        if remove and diverse_G.has_edge(seg.start_node_id, seg.end_node_id):
            diverse_G.remove_edge(seg.start_node_id, seg.end_node_id)

    if diversity == DiversityType.full_nodes:
        for node_id in primary_path[1:-1]:
            if diverse_G.has_node(node_id):
                diverse_G.remove_node(node_id)

    return diverse_G


def find_routes(
    G: nx.Graph,
    start: str,
    end: str,
    must_include_nodes: list[str],
    must_avoid_nodes: list[str],
    must_avoid_segments: list[str],
    must_include_segments: list[str],
    must_include_systems: list[str],
    must_avoid_systems: list[str],
    diversity: DiversityType,
    segments_by_id: dict[str, CableSegment],
    rules: list[InterconnectRule],
    k: int = 30,
    max_wet_hops: int | None = None,
    max_terrestrial_hops: int | None = None,
    capacities_by_id: dict[str, SegmentCapacity] | None = None,
    optimise_for: str | None = None,
    outage_segment_ids: "set[str] | None" = None,
) -> RouteResponse:
    # Build working graph with avoided nodes/segments/systems removed
    working_G = G.copy()

    for node_id in must_avoid_nodes:
        if working_G.has_node(node_id):
            working_G.remove_node(node_id)

    avoid_edges: set[tuple[str, str]] = set()
    for seg_id in must_avoid_segments:
        seg = segments_by_id.get(seg_id)
        if seg and working_G.has_edge(seg.start_node_id, seg.end_node_id):
            avoid_edges.add((seg.start_node_id, seg.end_node_id))
            working_G.remove_edge(seg.start_node_id, seg.end_node_id)

    for sys_id in must_avoid_systems:
        for seg in segments_by_id.values():
            if seg.system_id == sys_id and working_G.has_edge(seg.start_node_id, seg.end_node_id):
                avoid_edges.add((seg.start_node_id, seg.end_node_id))
                working_G.remove_edge(seg.start_node_id, seg.end_node_id)

    if start not in working_G or end not in working_G:
        return RouteResponse(routes=[], primary_routes=[], diverse_routes=[])

    # Expand must_include_segments into node waypoints so the pathfinder
    # routes *through* those edges rather than post-filtering short paths.
    required_seg_ids = set(must_include_segments)
    seg_waypoints: list[str] = []
    for seg_id in must_include_segments:
        seg = segments_by_id.get(seg_id)
        if seg:
            seg_waypoints.extend([seg.start_node_id, seg.end_node_id])

    all_waypoints = seg_waypoints + list(must_include_nodes)

    # Search a large candidate pool so total_found is meaningful.
    # System-include filtering is aggressive, so use an even larger pool there.
    raw_k = 1000 if must_include_systems else 500
    if all_waypoints:
        candidates = _apply_waypoints(working_G, start, end, all_waypoints, rules, set(), k)
    else:
        try:
            raw = itertools.islice(nx.shortest_simple_paths(working_G, start, end, weight="length_km"), raw_k)
            candidates = [p for p in raw if validate_interconnect_rules(working_G, p, rules)]
        except nx.NetworkXNoPath:
            candidates = []

    # Final guard: confirm the required segments are actually on each path
    if required_seg_ids:
        candidates = [
            p for p in candidates
            if required_seg_ids.issubset(set(path_to_segment_ids(working_G, p)))
        ]

    # Filter: each must_include_system needs at least one segment from that system
    if must_include_systems:
        seg_system = {s.id: s.system_id for s in segments_by_id.values()}
        must_sys_set = set(must_include_systems)
        candidates = [
            p for p in candidates
            if must_sys_set.issubset({
                seg_system[sid] for sid in path_to_segment_ids(working_G, p) if sid in seg_system
            })
        ]

    # Filter by max hop counts — each segment is one hop, classified by type
    if max_wet_hops is not None or max_terrestrial_hops is not None:
        def hop_counts(path: list[str]) -> tuple[int, int]:
            wet = terr = 0
            for seg_id in path_to_segment_ids(working_G, path):
                seg = segments_by_id.get(seg_id)
                if seg:
                    if seg.type == "wet":
                        wet += 1
                    else:
                        terr += 1
            return wet, terr

        filtered = []
        for p in candidates:
            wet_c, terr_c = hop_counts(p)
            if max_wet_hops is not None and wet_c > max_wet_hops:
                continue
            if max_terrestrial_hops is not None and terr_c > max_terrestrial_hops:
                continue
            filtered.append(p)
        candidates = filtered

    total_found = len(candidates)
    candidates = _select_candidates(
        candidates, k, working_G, segments_by_id, capacities_by_id or {}, optimise_for, outage_segment_ids
    )

    if not candidates:
        return RouteResponse(routes=[], primary_routes=[], diverse_routes=[], total_found=0)

    # ── No diversity ──────────────────────────────────────────────────────────
    if diversity == DiversityType.none:
        primary_routes = [
            _build_route(working_G, path, segments_by_id, f"route-{i}", 1)
            for i, path in enumerate(candidates, start=1)
        ]
        return RouteResponse(
            routes=primary_routes,
            primary_routes=primary_routes,
            diverse_routes=[],
            total_found=total_found,
        )

    # ── Diversity pairs ───────────────────────────────────────────────────────
    # For every primary candidate, find its best diverse counterpart.
    # Only candidates that yield a valid diverse path form a "pair".
    paired_primaries: list[list[str]] = []
    paired_diverse: list[list[str]] = []

    for primary_path in candidates:
        diverse_G = _make_diverse_graph(working_G, primary_path, segments_by_id, diversity)

        if must_include_nodes:
            d_cands = _apply_waypoints(
                diverse_G, start, end, must_include_nodes, rules, set(), k=5
            )
        else:
            try:
                raw = itertools.islice(
                    nx.shortest_simple_paths(diverse_G, start, end, weight="length_km"), 100
                )
                d_cands = [p for p in raw if validate_interconnect_rules(diverse_G, p, rules)][:5]
            except nx.NetworkXNoPath:
                d_cands = []

        if d_cands:
            # Pick best diverse candidate by cost rather than just shortest
            best_d = min(d_cands, key=lambda p: _path_cost(working_G, p))
            paired_primaries.append(primary_path)
            paired_diverse.append(best_d)

    # Build Route objects — pair index is the diversity_group so the frontend can
    # match primary_routes[i] with diverse_routes[i] by diversity_group.
    primary_routes = [
        _build_route(working_G, p, segments_by_id, f"route-{i}", i)
        for i, p in enumerate(paired_primaries, start=1)
    ]
    diverse_routes = [
        _build_route(working_G, d, segments_by_id, f"diverse-{i}", i)
        for i, d in enumerate(paired_diverse, start=1)
    ]

    return RouteResponse(
        routes=primary_routes + diverse_routes,
        primary_routes=primary_routes,
        diverse_routes=diverse_routes,
        total_found=total_found,
    )
