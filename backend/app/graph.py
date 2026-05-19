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

        for pair in rules_by_node[node].disallowed_pairs:
            if [in_sys, out_sys] == pair or [out_sys, in_sys] == pair:
                return False

    return True
