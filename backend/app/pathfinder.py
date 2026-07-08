"""
Route search engine — the algorithmic heart of RouteBuilder.

Given the network graph built by graph.py (nodes = CLS / PoP / branching-unit
sites, edges = cable segments), this module finds ranked end-to-end routes
between two nodes subject to the user's constraints, and optionally pairs each
route with a physically DIVERSE (separate) protection path.

Who calls it: api/routes.py is the single entry point in production —
    POST /api/routes with a RouteRequest body
      → routes.search_routes() loads reference data, builds the graph
      → find_routes(...) (this module)
      → RouteResponse {routes, primary_routes, diverse_routes, total_found}
The pytest suite also calls find_routes directly.

────────────────────────────────────────────────────────────────────────────
THE PIPELINE (find_routes, top to bottom)

1. PRUNE THE GRAPH. Copy the master graph and delete everything the request
   forbids: must_avoid_nodes (node removed), must_avoid_segments (edge
   removed), must_avoid_systems (every edge of that system removed),
   must_avoid_countries (every non-branching-unit node in the country
   removed). If an endpoint itself was pruned, or the destination has a
   no_handoff rule, return an empty response immediately.

2. ENUMERATE CANDIDATES. Use networkx shortest_simple_paths (Yen's k-shortest
   paths — loopless, ascending weight) to stream up to 1000 raw paths,
   weighted by length_km (or by hop count when optimise_for == "hops").
   Each path must pass:
     * validate_interconnect_rules — per-node system-pairing restrictions
       (see graph.py: which cable systems may be patched together at a node),
     * validate_handoff_rules — destination must be allowed to terminate.
   If waypoints are required (must_include_nodes, or must_include_segments —
   whose endpoints are expanded into waypoints), _apply_waypoints instead
   searches each leg (start→wp1→…→end) and stitches legs together.
   Then hard filters: required segments/systems actually on the path, and
   max_wet_hops / max_terrestrial_hops (each segment = one hop, classified
   by its wet/terrestrial type).

3. SELECT k (default 50). _select_candidates trims the candidate pool either
   by a single dimension (optimise_for = hops/distance/latency/ownership/
   capacity, or "outages" = prefer routes with no live cable faults) or, by
   default, by "multi-dimension pooling": take the top few candidates from
   EACH dimension's ranking so the returned set is varied rather than 50
   near-identical shortest paths.

4. DIVERSITY PAIRING (if requested). For every selected primary path, build a
   "diverse graph" with the primary's protected assets deleted, then find the
   best alternate path in it. Primaries with no valid alternate are dropped;
   survivors are returned as matched pairs (worker-i / protected-i sharing
   diversity_group == i).

────────────────────────────────────────────────────────────────────────────
EDGE WEIGHTS AND ROUTE METRICS

Each segment (edge) carries independent metrics; nothing is blended into a
single score. Along a route they aggregate as:
  * total_length_km  = SUM of length_km        (also the search weight)
  * total_cost       = SUM of cost_weight      (relative commercial cost)
  * total_latency    = SUM of latency (ms)     (missing latency counts as 0)
  * end_to_end_reliability = PRODUCT of per-segment reliability values
    (each in (0,1]; e.g. 0.999 × 0.998 = 0.997002 — more segments and less
    reliable segments both reduce the product)
  * ownership is averaged via _OWNERSHIP_SCORE for ranking only (owned/IRU
    best, off-net resell worst; IRU = Indefeasible Right of Use, a long-term
    capacity lease that behaves like ownership).

────────────────────────────────────────────────────────────────────────────
DIVERSITY MODES (DiversityType) — what gets removed from the diverse graph

"Diversity" = a physically separate backup path, so one cable break cannot
take down both routes. Modes differ in WHICH parts must be separate:
  * none         — no protection path computed.
  * wet          — wet-path-disjoint: only the primary's WET (submarine)
                   segments are removed; the backup may reuse terrestrial
                   (land backhaul) segments. Protects against cable ship
                   anchors, fishing gear, subsea faults.
  * terrestrial_origin / terrestrial_destination / terrestrial_both
                 — the leading and/or trailing run of consecutive
                   TERRESTRIAL segments (walked inward from each end until
                   the first wet segment) is removed, forcing a different
                   land tail at that end. Protects against backhaul cuts
                   near the customer site.
  * full         — segment-disjoint: EVERY edge of the primary is removed;
                   the backup shares no segment but may cross the same
                   intermediate stations.
  * full_nodes   — node-disjoint: full, PLUS every intermediate node of the
                   primary is deleted, so the backup avoids the primary's
                   stations entirely (strongest protection: survives a whole
                   site failure).

────────────────────────────────────────────────────────────────────────────
WORKED EXAMPLE

Toy network (all wet unless noted):
    SIN3 ──EAC-1──> HKG1 ──EAC-2──> TKO1        (EAC system, 2600+2900 km)
    SIN3 ──C2C-1──> TPE1 ──C2C-2──> TKO1        (C2C system, 3300+2100 km)
    HKG1 ──terr──> TPE1                          (terrestrial, 800 km)

Request: POST /api/routes {start_node_id: "SIN3", end_node_id: "TKO1",
                           diversity: "full", must_avoid_countries: []}

1. Nothing to prune. 2. shortest_simple_paths yields, ascending length:
   P1 = SIN3-HKG1-TKO1 (5500 km, all EAC), P2 = SIN3-TPE1-TKO1 (5400 km...
   ordering per real lengths), P3 = SIN3-HKG1-TPE1-TKO1 (mixed EAC/C2C via
   the terrestrial hop — this one dies if TPE1 has an interconnect rule
   disallowing {EAC, C2C}). 3. Both survivors enter the pool. 4. For P1 the
   diverse graph drops EAC-1 and EAC-2; the alternate found is
   SIN3-TPE1-TKO1 on C2C — physically separate, so the pair is returned as
   worker-1 / protected-1 with diversity_group=1. Metrics: P1 total_length
   = 5500 km, reliability = product of the two segments' values, cost =
   sum of their cost_weights.
"""
from __future__ import annotations
import math
import itertools
import networkx as nx
from .models import (
    CableSegment, InterconnectRule, DiversityType,
    Route, RouteSegmentDetail, RouteResponse, SegmentCapacity
)

# Ranking score per ownership class (higher = more preferred / better margin).
# "owned" and "iru" (Indefeasible Right of Use — a long-term lease treated
# commercially like ownership) score equally at the top; capacity resold from
# another carrier's network ("offnet_resell") scores lowest. Used only when
# ranking candidates by average ownership — never as a hard filter.
_OWNERSHIP_SCORE: dict[str, int] = {
    "owned": 3, "iru": 3, "consortium": 2,
    "integrated_lit_lease": 1, "offnet_resell": 0,
}

# Maps an optimise_for value from the API to a single-dimension sort over the
# precomputed per-candidate metrics tuple (see _select_candidates).
_OPTIMISE_SORT: dict[str, tuple[int, bool]] = {
    # (metrics-tuple index, reverse=True means descending)
    # metrics = (hops, length_km, latency, ownership_avg, cap_min)
    "hops":      (0, False),   # fewest segments first
    "distance":  (1, False), "length":   (1, False),  # shortest first (aliases)
    "latency":   (2, False),   # lowest round-trip contribution first
    "ownership": (3, True),    # highest average ownership score first
    "capacity":  (4, True),    # largest bottleneck (min available Tbps) first
}
from .graph import validate_interconnect_rules, validate_handoff_rules, path_to_segment_ids


def _path_length(G: nx.Graph, node_path: list[str]) -> float:
    """Total length_km of a node path — used to compare diverse candidates."""
    return sum(
        G[node_path[i]][node_path[i + 1]]["length_km"]
        for i in range(len(node_path) - 1)
    )


def _build_route(
    G: nx.Graph,
    node_path: list[str],
    segments_by_id: dict[str, CableSegment],
    route_id: str,
    diversity_group: int,
) -> Route:
    """Materialise a node path into a full Route API object.

    Converts the path into its segment list and aggregates the route-level
    metrics (see the module docstring for the formulas):
      total_cost        — sum of segment cost_weights,
      total_length_km   — sum of segment lengths,
      total_latency     — sum of segment latencies (None counts as 0),
      end_to_end_reliability — PRODUCT of segment reliabilities.
    diversity_group links a primary route to its diverse counterpart: the
    frontend matches primary_routes[i] with diverse_routes[i] via this value.
    """
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
    """Find paths through mandatory waypoints in order.

    Used when the request has must_include_nodes (or must_include_segments,
    whose endpoints are expanded into waypoints upstream). A plain k-shortest
    -paths search would rarely happen to pass through a required node, so
    instead the journey is split into legs — start → wp1 → wp2 → … → end —
    and each leg is searched independently (up to k valid paths per leg,
    drawn from a pool of k*3 raw candidates so rule-violating ones can be
    discarded). Leg paths are then stitched together combinatorially,
    dropping the duplicated junction node at each join.

    Two safety rails during stitching:
      * a combination is rejected if a leg would reuse an edge already in the
        partial route (a segment must not appear twice in one route);
      * the combined list is capped at k after each leg to bound the
        combinatorial blow-up.

    avoid_edges lets callers pre-remove specific edges from the working copy.
    Returns [] as soon as any leg is unroutable (a hard constraint failed).
    Interconnect rules are checked per leg; handoff rules are checked by the
    caller on the final stitched paths.
    """
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
    """Pick k routes using multi-dimension pooling or a single-dimension sort.

    The raw candidate list can hold up to ~1000 length-ordered paths; this
    trims it to the k the API returns. Three strategies, in priority order:

    1. optimise_for == "outages": keep only routes with no segment on the
       active-outage list (live cable faults), shortest first. If EVERY
       candidate is impacted, fall back to all candidates rather than
       returning nothing.
    2. optimise_for is another known dimension (see _OPTIMISE_SORT): sort all
       candidates by that one metric and take the top k.
    3. Default "multi-dimension pooling": rank candidates separately by hops,
       length, latency, ownership (and bottleneck capacity when capacity data
       exists), then round-robin the top few from each ranking into the pool.
       This gives users a VARIED shortlist — the shortest route, the
       fewest-hop route, the best-owned route… — instead of k near-identical
       shortest paths. Leftover slots are filled by length order.

    Metrics per candidate (computed once): (hop count, total length_km,
    total latency, average ownership score, minimum available capacity in
    Tbps across the route — the bottleneck).
    """
    if len(candidates) <= k and optimise_for != "outages":
        return candidates

    # Precompute metrics once: (hops, length_km, latency, ownership_avg, cap_min)
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
            sum(_OWNERSHIP_SCORE.get(str(s.ownership), 0) for s in segs) / n,
            min(cap_vals) if cap_vals else 0.0,
        ))

    # Outage filter: keep only routes with no active outage on any segment
    if optimise_for == "outages" and outage_segment_ids:
        clean = [i for i, sids in enumerate(all_seg_ids) if not any(sid in outage_segment_ids for sid in sids)]
        work = clean if clean else list(range(len(candidates)))
        length_order = sorted(work, key=lambda i: metrics[i][1])
        return [candidates[i] for i in length_order[:k]]

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
        sorted(range(len(candidates)), key=lambda i: -metrics[i][3]),       # ownership desc
    ]
    if any(m[4] > 0 for m in metrics):
        dims.append(sorted(range(len(candidates)), key=lambda i: -metrics[i][4]))  # capacity desc

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

    # Fill any remaining slots with length-ordered candidates
    for idx in dims[1]:
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
    """Return a copy of working_G with the primary path's relevant edges/nodes removed.

    This is how diversity ("physically separate backup path") is implemented:
    delete the assets the backup must NOT share, then run an ordinary
    shortest-path search on what remains. What gets deleted depends on mode:

      * full / full_nodes — every edge (segment) of the primary. full_nodes
        additionally deletes every INTERMEDIATE node of the primary, making
        the backup node-disjoint (survives a whole-station failure), not just
        segment-disjoint.
      * wet — only the primary's wet (submarine) edges; terrestrial backhaul
        may be shared. This is "wet-path diversity": protection against
        subsea cable faults specifically.
      * terrestrial_origin / terrestrial_destination / terrestrial_both —
        only the unbroken run of terrestrial segments at the relevant end(s)
        of the primary (walked inward from each end, stopping at the first
        wet segment). Forces a different land tail at that end.

    The start and end nodes are never removed — both routes must obviously
    share the two circuit endpoints.
    """
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
    k: int = 50,
    max_wet_hops: int | None = None,
    max_terrestrial_hops: int | None = None,
    capacities_by_id: dict[str, SegmentCapacity] | None = None,
    optimise_for: str | None = None,
    outage_segment_ids: "set[str] | None" = None,
    must_avoid_countries: list[str] | None = None,
    must_include_countries: list[str] | None = None,
    country_to_node_ids: "dict[str, set[str]] | None" = None,
) -> RouteResponse:
    """Find up to k constrained routes from `start` to `end`, with optional diverse pairs.

    This is the module's public entry point (called by api/routes.py per
    POST /api/routes request; see the module docstring for the full pipeline
    and a worked example). Parameter cheat-sheet:

      G                     master graph from graph.build_graph (not mutated —
                            all pruning happens on a copy)
      start / end           node ids of the circuit endpoints
      must_include_nodes    transit nodes the route MUST pass through, in the
                            given order (waypoint search)
      must_avoid_nodes      nodes removed from the graph entirely
      must_include_segments segments the route MUST use (their endpoints are
                            injected as waypoints, then membership re-checked)
      must_avoid_segments   edges removed from the graph
      must_include_systems  the route must use ≥1 segment from EACH listed
                            cable system
      must_avoid_systems    all edges of these systems removed
      diversity             which protection mode to compute (see
                            _make_diverse_graph); DiversityType.none skips
                            pairing entirely
      segments_by_id        CableSegment lookup used to enrich edges into
                            RouteSegmentDetail objects
      rules                 per-node InterconnectRules (system pairing and
                            handoff restrictions)
      k                     max routes returned (candidate pool is ~1000)
      max_wet_hops /        caps on the number of wet (submarine) /
      max_terrestrial_hops  terrestrial (land) segments per route
      capacities_by_id      available-capacity data for capacity ranking
      optimise_for          single-dimension ranking override, or "outages"
                            to prefer fault-free routes (see _select_candidates)
      outage_segment_ids    segment ids with an active cable fault
      must_avoid_countries  ISO country codes whose non-branching-unit nodes
      / must_include_countries / country_to_node_ids
                            are removed / required; country_to_node_ids maps
                            country code → node ids (built by the API layer)

    Returns a RouteResponse:
      * diversity == none: primary_routes = the k selected routes
        (ids "route-1"...), diverse_routes empty.
      * otherwise: only primaries that HAVE a valid diverse counterpart are
        kept, as matched pairs — primary_routes[i] ("worker-i") pairs with
        diverse_routes[i] ("protected-i") via diversity_group == i.
      * total_found = candidate count BEFORE trimming to k, so the UI can say
        "showing 5 of 213 possible routes".
    """
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

    # Country avoidance — remove all non-BU transit nodes in avoided countries.
    # If an endpoint is in an avoided country the constraint is unsatisfiable.
    if must_avoid_countries and country_to_node_ids:
        start_node_countries = {c for c, ids in country_to_node_ids.items() if start in ids}
        end_node_countries   = {c for c, ids in country_to_node_ids.items() if end   in ids}
        for country in must_avoid_countries:
            if country in start_node_countries or country in end_node_countries:
                return RouteResponse(routes=[], primary_routes=[], diverse_routes=[], total_found=0)
        for country in must_avoid_countries:
            for node_id in (country_to_node_ids.get(country) or set()):
                if node_id != start and node_id != end and working_G.has_node(node_id):
                    working_G.remove_node(node_id)

    if start not in working_G or end not in working_G:
        return RouteResponse(routes=[], primary_routes=[], diverse_routes=[])

    # Early exit if the destination node has a no_handoff rule
    _rules_by_node = {r.node_id: r for r in rules}
    if end in _rules_by_node and _rules_by_node[end].no_handoff:
        return RouteResponse(routes=[], primary_routes=[], diverse_routes=[], total_found=0)

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
    # Use hop-count ordering when optimising for hops so short-hop routes aren't
    # excluded by a distance-first search. Otherwise use distance (length_km).
    raw_k = 1000
    init_weight: str | None = None if optimise_for == "hops" else "length_km"
    if all_waypoints:
        candidates = _apply_waypoints(working_G, start, end, all_waypoints, rules, set(), k)
        candidates = [p for p in candidates if validate_handoff_rules(working_G, p, rules)]
    else:
        try:
            raw = itertools.islice(nx.shortest_simple_paths(working_G, start, end, weight=init_weight), raw_k)
            candidates = [
                p for p in raw
                if validate_interconnect_rules(working_G, p, rules)
                and validate_handoff_rules(working_G, p, rules)
            ]
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

    # Country include — keep only paths that visit at least one non-BU node per required country.
    if must_include_countries and country_to_node_ids:
        for country in must_include_countries:
            country_nodes = country_to_node_ids.get(country, set())
            candidates = [p for p in candidates if any(n in country_nodes for n in p)]

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
                d_cands = [
                    p for p in raw
                    if validate_interconnect_rules(diverse_G, p, rules)
                    and validate_handoff_rules(diverse_G, p, rules)
                ][:5]
            except nx.NetworkXNoPath:
                d_cands = []

        if d_cands:
            # Pick best diverse candidate by cost rather than just shortest
            best_d = min(d_cands, key=lambda p: _path_length(working_G, p))
            paired_primaries.append(primary_path)
            paired_diverse.append(best_d)

    # Build Route objects — pair index is the diversity_group so the frontend can
    # match primary_routes[i] with diverse_routes[i] by diversity_group.
    primary_routes = [
        _build_route(working_G, p, segments_by_id, f"worker-{i}", i)
        for i, p in enumerate(paired_primaries, start=1)
    ]
    diverse_routes = [
        _build_route(working_G, d, segments_by_id, f"protected-{i}", i)
        for i, d in enumerate(paired_diverse, start=1)
    ]

    return RouteResponse(
        routes=primary_routes + diverse_routes,
        primary_routes=primary_routes,
        diverse_routes=diverse_routes,
        total_found=total_found,
    )
