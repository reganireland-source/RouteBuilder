"""
Graph construction and path-validation helpers for the RouteBuilder network.

This module is one half of the "algorithmic heart" of RouteBuilder (the other
half is pathfinder.py, which runs searches over the graph built here). It turns
the flat reference data — Nodes and CableSegments loaded from JSON/Postgres by
data_loader.py — into an undirected networkx Graph that pathfinder.py and the
route-search API can traverse.

Domain glossary (used throughout this file and pathfinder.py):
  * Node        — a physical network location: a CLS (Cable Landing Station,
                  where a submarine cable comes ashore), a PoP (point of
                  presence, i.e. a terrestrial data-centre site), or a
                  branching unit (an undersea Y-split in a cable).
  * Segment     — one edge of the network: a stretch of cable between two
                  nodes. A "wet" segment is a submarine (undersea) cable
                  section; a "terrestrial" segment is land backhaul fibre
                  (e.g. CLS → city PoP).
  * System      — a named submarine cable system (e.g. EAC, AAG, C2C). Every
                  wet segment belongs to exactly one system.
  * Interconnect rule — a per-node restriction on which pairs of systems may
                  be cross-connected (patched together) at that node. Some
                  stations physically or contractually cannot hand traffic
                  from cable A to cable B.
  * Ownership   — how we hold the capacity on a segment: owned, IRU
                  (Indefeasible Right of Use — a long-term lease that behaves
                  like ownership), consortium share, lit lease, or off-net
                  resell.

How the graph maps to the domain:
  * graph node  = Node.id (string, e.g. "SIN3"), with all Node fields copied
                  onto the node's attribute dict.
  * graph edge  = one CableSegment connecting seg.start_node_id and
                  seg.end_node_id. The edge carries the segment's id, system,
                  type (wet/terrestrial), length_km, reliability, cost_weight,
                  ownership and name as edge attributes.
  * The graph is UNDIRECTED (cables carry traffic both ways) and simple: at
    most one edge per node pair. If two segments connect the same pair of
    nodes, the later one wins — the data model assumes parallel segments
    don't exist between the same two nodes.

Who calls this module:
  * api/routes.py       — builds the graph per request, then calls
                          pathfinder.find_routes().
  * pathfinder.py       — uses path_to_segment_ids and the two validate_*
                          functions while searching.
  * tests               — exercise rule validation directly.

Typical flow:
  POST /api/routes → build_graph(load_nodes(), load_segments())
                   → pathfinder.find_routes(G, ...)
                   → each candidate node-path is checked with
                     validate_interconnect_rules / validate_handoff_rules
                   → surviving paths become Route objects.
"""
import networkx as nx
from .models import Node, CableSegment, InterconnectRule


def build_graph(
    nodes: list[Node],
    segments: list[CableSegment],
) -> nx.Graph:
    """Build the undirected networkx graph from reference data.

    Every Node becomes a graph node keyed by its id, carrying the full model
    dump as attributes (name, lat/lng, type, country, ...). Every CableSegment
    becomes an edge between its start and end node ids, carrying the metrics
    the pathfinder needs:

      * length_km   — physical cable length; the default shortest-path weight.
      * reliability — per-segment availability in (0, 1]; multiplied along a
                      path to get end-to-end reliability.
      * cost_weight — relative commercial cost of using the segment; summed
                      along a path to give total_cost.
      * system_id   — which submarine cable system the segment belongs to;
                      used by the interconnect-rule checks.
      * type        — "wet" (submarine) or "terrestrial" (land backhaul);
                      used by diversity and hop-limit logic.

    Note: edges referencing nodes that were not added are still created by
    networkx (it auto-creates missing endpoints), so data integrity is
    enforced separately by data_checks.py rather than here.
    """
    G = nx.Graph()

    for node in nodes:
        G.add_node(node.id, **node.model_dump())

    for seg in segments:
        G.add_edge(
            seg.start_node_id,
            seg.end_node_id,
            id=seg.id,
            system_id=seg.system_id,
            type=seg.type,
            length_km=seg.length_km,
            reliability=seg.reliability,
            cost_weight=seg.cost_weight,
            ownership=seg.ownership,
            name=seg.name,
        )

    return G


def get_edge_segment_id(G: nx.Graph, u: str, v: str) -> str | None:
    """Return the segment id stored on the edge between nodes u and v.

    Returns None when no edge exists (e.g. the pair isn't directly connected,
    or the edge was removed by an avoid-constraint or diversity carve-out).
    """
    data = G.get_edge_data(u, v)
    return data["id"] if data else None


def path_to_segment_ids(G: nx.Graph, node_path: list[str]) -> list[str]:
    """Translate a node path into the ordered list of segment ids it uses.

    networkx path algorithms return paths as node lists (e.g.
    ["SIN3", "HKG1", "TKO1"]); the rest of the app thinks in segments. This
    walks consecutive node pairs and collects each edge's segment id. Pairs
    with no edge are silently skipped (shouldn't happen for a valid path).
    """
    result = []
    for i in range(len(node_path) - 1):
        seg_id = get_edge_segment_id(G, node_path[i], node_path[i + 1])
        if seg_id:
            result.append(seg_id)
    return result


def validate_interconnect_rules(
    G: nx.Graph,
    node_path: list[str],
    rules: list[InterconnectRule],
) -> bool:
    """Check a candidate path against per-node system-pairing restrictions.

    An InterconnectRule restricts which cable SYSTEMS may be cross-connected
    at a given node. When a path transits an intermediate node, traffic
    arrives on one segment (belonging to system A) and departs on another
    (system B); this function verifies that the {A, B} pairing is permitted
    at that node. Endpoints (first/last node of the path) are not checked
    here — no cross-connect happens where the circuit terminates (that is
    validate_handoff_rules' job).

    Two rule mechanisms, both keyed by node_id:
      * allowed_pairs (whitelist): if EITHER the incoming or outgoing system
        appears anywhere in the node's allowed_pairs list, then the exact
        {in, out} pair must itself be listed — otherwise the path is
        rejected. Systems not mentioned in the whitelist at all are
        unaffected (they can pair freely, subject to the blacklist).
      * disallowed_pairs (blacklist): the exact {in, out} pair being listed
        rejects the path unconditionally.

    Pairs are unordered sets, so a rule forbidding EAC↔C2C blocks the
    transition in both directions. Staying on the same system through a node
    yields pair_set == {system}, which only trips a rule that explicitly
    lists a system paired with itself.

    Returns True when the whole path is acceptable, False on first violation.
    """
    rules_by_node = {r.node_id: r for r in rules}

    for i in range(1, len(node_path) - 1):
        node = node_path[i]
        if node not in rules_by_node:
            continue

        in_edge = G.get_edge_data(node_path[i - 1], node)
        out_edge = G.get_edge_data(node, node_path[i + 1])

        if not in_edge or not out_edge:
            continue

        in_sys = in_edge["system_id"]
        out_sys = out_edge["system_id"]
        rule = rules_by_node[node]
        pair_set = {in_sys, out_sys}

        # Whitelist check: if either system appears in allowed_pairs, the
        # transition must be explicitly listed — otherwise reject.
        if rule.allowed_pairs:
            whitelisted_systems = {s for p in rule.allowed_pairs for s in (p.system_a, p.system_b)}
            if in_sys in whitelisted_systems or out_sys in whitelisted_systems:
                if not any(pair_set == {p.system_a, p.system_b} for p in rule.allowed_pairs):
                    return False

        # Blacklist check: explicitly forbidden pairs are always rejected.
        for pair in rule.disallowed_pairs:
            if pair_set == {pair.system_a, pair.system_b}:
                return False

    return True


def validate_handoff_rules(
    G: nx.Graph,
    node_path: list[str],
    rules: list[InterconnectRule],
) -> bool:
    """Validate handoff rules for the terminal (destination) node of a path.

    "Handoff" = delivering the circuit to the customer at the destination
    node. Some nodes are transit-only (e.g. a branching unit or a station
    with no customer-facing equipment) and cannot terminate a circuit at
    all; others may only accept delivery from specific segments.

    Returns False if:
    - The end node has no_handoff=True (node cannot be a circuit endpoint), or
    - The end node has allowed_handoff_segments and the last segment into it is
      not in that allowed list.

    Otherwise returns True (including for trivial paths of < 2 nodes and for
    end nodes that have no rule at all). Only the DESTINATION end is checked;
    intermediate nodes are covered by validate_interconnect_rules.
    """
    if len(node_path) < 2:
        return True

    rules_by_node = {r.node_id: r for r in rules}
    end_node = node_path[-1]

    if end_node not in rules_by_node:
        return True

    rule = rules_by_node[end_node]

    if rule.no_handoff:
        return False

    if rule.allowed_handoff_segments:
        last_edge = G.get_edge_data(node_path[-2], end_node)
        if last_edge:
            last_seg_id = last_edge["id"]
            allowed_ids = {s.segment_id for s in rule.allowed_handoff_segments}
            if last_seg_id not in allowed_ids:
                return False

    return True
