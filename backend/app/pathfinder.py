import math
import itertools
import networkx as nx
from .models import (
    CableSegment, InterconnectRule, DiversityType,
    Route, RouteSegmentDetail, RouteResponse
)
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


def find_routes(
    G: nx.Graph,
    start: str,
    end: str,
    must_include_nodes: list[str],
    must_avoid_nodes: list[str],
    must_avoid_segments: list[str],
    must_include_segments: list[str],
    diversity: DiversityType,
    segments_by_id: dict[str, CableSegment],
    rules: list[InterconnectRule],
    k: int = 5,
) -> RouteResponse:
    # Build working graph with avoided nodes/segments removed
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

    # Find primary candidates
    if all_waypoints:
        candidates = _apply_waypoints(working_G, start, end, all_waypoints, rules, set(), k)
    else:
        try:
            raw = itertools.islice(nx.shortest_simple_paths(working_G, start, end, weight="length_km"), k * 3)
            candidates = [p for p in raw if validate_interconnect_rules(working_G, p, rules)][:k]
        except nx.NetworkXNoPath:
            candidates = []

    # Final guard: confirm the required segments are actually on each path
    if required_seg_ids:
        candidates = [
            p for p in candidates
            if required_seg_ids.issubset(set(path_to_segment_ids(working_G, p)))
        ]

    if not candidates:
        return RouteResponse(routes=[], primary_routes=[], diverse_routes=[])

    primary_path = candidates[0]
    primary_route = _build_route(working_G, primary_path, segments_by_id, "route-1", 1)
    primary_routes = [primary_route]

    # Build additional ranked primaries (up to k total)
    for i, path in enumerate(candidates[1:], start=2):
        primary_routes.append(_build_route(working_G, path, segments_by_id, f"route-{i}", 1))

    diverse_routes: list[Route] = []

    if diversity != DiversityType.none:
        # Identify origin-end and destination-end terrestrial segments
        def end_terrestrial_ids(from_origin: bool) -> set[str]:
            segs = primary_route.segments if from_origin else list(reversed(primary_route.segments))
            result = set()
            for s in segs:
                if s.type == "terrestrial":
                    result.add(s.segment_id)
                else:
                    break
            return result

        origin_terr = end_terrestrial_ids(from_origin=True)
        dest_terr = end_terrestrial_ids(from_origin=False)

        edges_to_remove: list[tuple[str, str]] = []

        for seg in primary_route.segments:
            seg_id = seg.segment_id
            full_seg = segments_by_id.get(seg_id)
            if not full_seg:
                continue
            include = (
                diversity in (DiversityType.full, DiversityType.full_nodes)
                or (diversity == DiversityType.wet and seg.type == "wet")
                or (diversity == DiversityType.terrestrial_origin and seg_id in origin_terr)
                or (diversity == DiversityType.terrestrial_destination and seg_id in dest_terr)
                or (diversity == DiversityType.terrestrial_both and seg_id in (origin_terr | dest_terr))
            )
            if include:
                edges_to_remove.append((full_seg.start_node_id, full_seg.end_node_id))

        diverse_G = working_G.copy()
        for u, v in edges_to_remove:
            if diverse_G.has_edge(u, v):
                diverse_G.remove_edge(u, v)

        # For full_nodes: also remove all intermediate nodes from the primary path.
        # This prevents the diverse route from transiting any shared node (CLS, BU,
        # terrestrial PoP, etc.) — only the two endpoints are permitted to be common.
        if diversity == DiversityType.full_nodes:
            for node_id in primary_path[1:-1]:
                if diverse_G.has_node(node_id):
                    diverse_G.remove_node(node_id)

        if must_include_nodes:
            diverse_candidates = _apply_waypoints(
                diverse_G, start, end, must_include_nodes, rules, set(), k
            )
        else:
            try:
                raw = itertools.islice(nx.shortest_simple_paths(diverse_G, start, end, weight="length_km"), k * 3)
                diverse_candidates = [
                    p for p in raw if validate_interconnect_rules(diverse_G, p, rules)
                ][:k]
            except nx.NetworkXNoPath:
                diverse_candidates = []

        for i, path in enumerate(diverse_candidates, start=1):
            diverse_routes.append(
                _build_route(diverse_G, path, segments_by_id, f"diverse-{i}", 2)
            )

    all_routes = primary_routes + diverse_routes
    return RouteResponse(
        routes=all_routes,
        primary_routes=primary_routes,
        diverse_routes=diverse_routes,
    )
