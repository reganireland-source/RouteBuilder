import networkx as nx
from .models import Node, CableSegment, InterconnectRule


def build_graph(
    nodes: list[Node],
    segments: list[CableSegment],
) -> nx.Graph:
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
    data = G.get_edge_data(u, v)
    return data["id"] if data else None


def path_to_segment_ids(G: nx.Graph, node_path: list[str]) -> list[str]:
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

    Returns False if:
    - The end node has no_handoff=True (node cannot be a circuit endpoint), or
    - The end node has allowed_handoff_segments and the last segment into it is
      not in that allowed list.
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
