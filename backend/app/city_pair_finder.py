"""
Wet-only city-pair routing.

Finds multi-hop submarine cable system combinations connecting two cities.
System handoffs are only permitted at landing_station (CLS) nodes;
branching units must maintain the same system on both sides.
PoP types (primary_pop, secondary_pop, extension_pop) are terrestrial only
and are not included in the wet graph.

Purpose and how it differs from pathfinder.py:
  pathfinder.py answers "route me from node A to node B" over the FULL
  network (wet + terrestrial). This module answers a coarser, planning-level
  question: "which SUBMARINE CABLE SYSTEMS can connect city X to city Y, and
  in what combinations?" — e.g. Singapore→Tokyo might be reachable via
  [EAC] direct, or via [SJC, APG] with a handoff in Hong Kong. It ignores
  terrestrial backhaul entirely and deduplicates results by system sequence,
  so each distinct cable itinerary appears once regardless of the exact
  landing stations used.

Glossary:
  * wet segment    — a submarine (undersea) cable section; the only segment
                     type used here ("terrestrial" = land backhaul, excluded).
  * CLS            — Cable Landing Station, where a submarine cable comes
                     ashore. A "city" here is the set of CLS nodes sharing
                     the same node name.
  * system         — a named submarine cable (e.g. EAC, AAG); a route's
                     itinerary is its ordered sequence of distinct systems.
  * branching unit — an undersea Y-split inside one cable system; traffic
                     cannot change systems mid-ocean, hence the rule that a
                     branching unit must have the same system on both sides.
  * hop_count      — number of distinct systems used (1 = direct cable).

Algorithm sketch (find_city_pair_routes):
  1. Build a wet-only graph of CLS + branching-unit nodes.
  2. Add one zero-cost "super node" per city, connected to all of that
     city's landing stations, so a single shortest-path search covers every
     CLS combination at both ends.
  3. Stream k-shortest simple paths (by length_km), reject paths that switch
     systems at a branching unit, deduplicate by system sequence, and stop
     after max_results unique itineraries (or 300 raw paths examined).

Who calls it: api/city_pairs.py —
  GET  /api/city-pairs/cities  → get_cities()
  POST /api/city-pairs/search {origin_city, destination_city}
       → find_city_pair_routes() → list of itinerary dicts (systems,
         landing stations, latency/length/reliability totals).
"""
from __future__ import annotations
import itertools
import networkx as nx
from .models import Node, CableSegment, CableSystem, NodeType, SegmentType

# Prefix for the synthetic per-city "super nodes" added during a search.
# Real node ids never start with this, so super nodes can be filtered back
# out of result paths by prefix.
_SUPER = "__CITY__"
_MAX_CANDIDATES = 300  # raw paths to examine before stopping


def get_cities(nodes: list[Node]) -> dict[str, list[str]]:
    """Return {city_name: [node_ids]} for all landing_station nodes.

    A "city" is defined by the CLS node NAME — e.g. two landing stations both
    named "Singapore" form one city with two node ids. Non-CLS nodes (PoPs,
    branching units) are ignored. Also used by GET /api/city-pairs/cities to
    populate the frontend's city dropdowns.
    """
    cities: dict[str, list[str]] = {}
    for n in nodes:
        if n.type == NodeType.landing_station:
            cities.setdefault(n.name, []).append(n.id)
    return cities


def _build_wet_graph(nodes: list[Node], segments: list[CableSegment]) -> nx.Graph:
    """Build the submarine-only graph: CLS + branching-unit nodes, wet edges.

    Terrestrial segments and PoP nodes are deliberately excluded — this
    finder reasons about cable systems between coastlines, not land
    backhaul. Edges keep the metrics needed for ranking and stats
    (length_km is the search weight; latency/reliability feed _path_stats).
    """
    G = nx.Graph()
    for n in nodes:
        if n.type in (NodeType.landing_station, NodeType.branching_unit):
            G.add_node(n.id, node_type=n.type.value, name=n.name, country=n.country)
    for seg in segments:
        if (
            seg.type == SegmentType.wet
            and seg.start_node_id in G
            and seg.end_node_id in G
        ):
            G.add_edge(
                seg.start_node_id, seg.end_node_id,
                segment_id=seg.id,
                system_id=seg.system_id,
                latency=seg.latency or 0.0,
                length_km=seg.length_km,
                cost_weight=seg.cost_weight,
                reliability=seg.reliability,
            )
    return G


def _valid_path(G: nx.Graph, path: list[str]) -> bool:
    """Reject paths where a branching unit sits at a system-change boundary.

    A branching unit is a passive undersea splitter INSIDE one cable system;
    there is no equipment down there to patch one cable to another. Traffic
    may therefore only change systems at a landing station, so any path whose
    incoming and outgoing systems differ at a branching unit is physically
    impossible and gets discarded.
    """
    for i in range(1, len(path) - 1):
        if G.nodes[path[i]].get("node_type") == "branching_unit":
            if G[path[i - 1]][path[i]].get("system_id") != G[path[i]][path[i + 1]].get("system_id"):
                return False
    return True


def _system_seq(G: nx.Graph, path: list[str]) -> tuple[str, ...]:
    """Ordered distinct system_ids traversed (super-node edges excluded).

    Consecutive segments on the same system collapse to one entry, so
    e.g. EAC, EAC, APG, APG → ("EAC", "APG"). This tuple is the itinerary's
    identity: results are deduplicated on it, and its length is hop_count.
    """
    seq: list[str] = []
    prev = None
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        if u.startswith(_SUPER) or v.startswith(_SUPER):
            continue
        s = G[u][v].get("system_id", "")
        if s != prev:
            seq.append(s)
            prev = s
    return tuple(seq)


def _path_stats(G: nx.Graph, path: list[str]) -> tuple[float, float, float]:
    """Return (total_latency_ms, total_length_km, end_to_end_reliability).

    Latency and length are summed across segments; reliability is the
    PRODUCT of per-segment values (each in (0, 1]). Zero-cost super-node
    edges are skipped so they never distort the totals.
    """
    lat = length = 0.0
    rel = 1.0
    for i in range(len(path) - 1):
        u, v = path[i], path[i + 1]
        if u.startswith(_SUPER) or v.startswith(_SUPER):
            continue
        e = G[u][v]
        lat    += e.get("latency",    0.0)
        length += e.get("length_km",  0.0)
        rel    *= e.get("reliability", 1.0)
    return round(lat, 2), round(length, 1), round(rel, 6)


def find_city_pair_routes(
    origin_city: str,
    destination_city: str,
    nodes: list[Node],
    segments: list[CableSegment],
    systems_by_id: dict[str, CableSystem],
    max_results: int = 15,
) -> list[dict]:
    """
    Find wet multi-hop routes between two cities, ordered by total cost.
    Deduplicates by unique system sequence so each cable itinerary
    appears at most once.
    """
    G = _build_wet_graph(nodes, segments)
    cities = get_cities(nodes)

    if origin_city not in cities:
        raise ValueError(f"Unknown city: {origin_city}")
    if destination_city not in cities:
        raise ValueError(f"Unknown city: {destination_city}")

    o_super = f"{_SUPER}{origin_city}"
    d_super = f"{_SUPER}{destination_city}"
    G.add_node(o_super, node_type="super")
    G.add_node(d_super, node_type="super")

    _zero = dict(segment_id="", system_id="", cost_weight=0.0,
                 latency=0.0, length_km=0.0, reliability=1.0)
    for nid in cities[origin_city]:
        if nid in G:
            G.add_edge(o_super, nid, **_zero)
    for nid in cities[destination_city]:
        if nid in G:
            G.add_edge(d_super, nid, **_zero)

    seen: set[tuple[str, ...]] = set()
    routes: list[dict] = []

    try:
        for path in itertools.islice(
            nx.shortest_simple_paths(G, o_super, d_super, weight="length_km"),
            _MAX_CANDIDATES,
        ):
            if len(routes) >= max_results:
                break
            if not _valid_path(G, path):
                continue
            sys_seq = _system_seq(G, path)
            if sys_seq in seen:
                continue
            seen.add(sys_seq)

            real_path = [n for n in path if not n.startswith(_SUPER)]
            cls_nodes = [n for n in real_path
                         if G.nodes[n].get("node_type") == "landing_station"]
            lat, length, rel = _path_stats(G, path)

            routes.append({
                "id": f"cp-{len(routes) + 1}",
                "systems": list(sys_seq),
                "system_names": [
                    systems_by_id[s].name if s in systems_by_id else s
                    for s in sys_seq
                ],
                "nodes": real_path,
                "cls_nodes": cls_nodes,
                "intermediate_cls": [
                    {"node_id": n, "name": G.nodes[n].get("name", n)}
                    for n in cls_nodes[1:-1]
                ],
                "total_latency_ms": lat,
                "total_length_km":  length,
                "end_to_end_reliability": rel,
                "hop_count": len(sys_seq),
            })
    except nx.NetworkXNoPath:
        pass

    return routes
