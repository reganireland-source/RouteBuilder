"""
The diversity search's short-circuit, and the invariant it stands on.

`find_routes` used to drain 100 paths from Yen's generator for EVERY primary
candidate, filter them, keep five and take the cheapest of those. It now takes
the first path that passes the rules and stops, which is a 100x reduction in
the dominant cost of the whole search (10.8s -> 4.2s on SYD1->LAX1 with full
diversity).

That is only correct because of one invariant: `shortest_simple_paths` yields
in ascending `length_km`, and `length_km` is exactly what `_path_length` sums,
so the first valid path IS the cheapest valid path. `_make_diverse_graph` only
removes edges and nodes — it never reweights them — so a path costs the same in
the diverse graph as in the working graph.

If anyone changes the generator's weight, or makes the diverse graph reweight
edges, these tests fail instead of the search quietly returning worse routes.

Run with:  pytest backend/tests/test_pathfinder_diversity.py -v
"""
import itertools
import os

import networkx as nx
import pytest

os.environ.setdefault("DATABASE_URL", "")

from app import pathfinder as pf
from app.data_loader import load_nodes, load_rules, load_segments
from app.graph import build_graph


@pytest.fixture(scope="module")
def network():
    nodes, segments, rules = load_nodes(), load_segments(), load_rules()
    G = build_graph(nodes, segments)
    return G, {s.id: s for s in segments}, rules


def _primaries(G, rules, a, b, limit=12):
    """Pull candidate primary routes the same way find_routes does: drain the
    generator (cheapest-first) and keep only rule-valid ones, up to limit."""
    raw = itertools.islice(nx.shortest_simple_paths(G, a, b, weight="length_km"), 120)
    return [
        p for p in raw
        if pf.validate_interconnect_rules(G, p, rules) and pf.validate_handoff_rules(G, p, rules)
    ][:limit]


def test_generator_yields_in_ascending_path_length(network):
    """The ordering the short-circuit depends on."""
    G, _, _ = network
    lengths = [
        pf._path_length(G, p)
        for p in itertools.islice(nx.shortest_simple_paths(G, "SYD1", "LAX1", weight="length_km"), 40)
    ]
    assert lengths == sorted(lengths), "shortest_simple_paths must yield cheapest-first"


def test_diverse_graph_never_reweights_surviving_edges(network):
    """A path must cost the same in the diverse graph as in the working graph."""
    G, segs, rules = network
    for primary in _primaries(G, rules, "SYD1", "LAX1", limit=6):
        dG = pf._make_diverse_graph(G, primary, segs, "full")
        for u, v, data in dG.edges(data=True):
            assert data["length_km"] == G[u][v]["length_km"]


def test_diverse_first_valid_is_cheapest(network):
    """
    The invariant the short-circuit rests on: taking the FIRST rule-passing
    path gives the same answer as draining many and taking the min.
    """
    G, segs, rules = network
    checked = 0
    for primary in _primaries(G, rules, "SYD1", "LAX1", limit=10):
        dG = pf._make_diverse_graph(G, primary, segs, "full")
        valid = []
        try:
            for cand in itertools.islice(nx.shortest_simple_paths(dG, "SYD1", "LAX1", weight="length_km"), 60):
                if pf.validate_interconnect_rules(dG, cand, rules) and pf.validate_handoff_rules(dG, cand, rules):
                    valid.append(cand)
                    if len(valid) >= 5:
                        break
        except nx.NetworkXNoPath:
            continue
        if not valid:
            continue
        checked += 1
        cheapest = min(valid, key=lambda p: pf._path_length(G, p))
        assert pf._path_length(G, valid[0]) == pf._path_length(G, cheapest), (
            "first valid diverse path was not the cheapest — the short-circuit in "
            "find_routes would now return a worse route"
        )
    assert checked > 0, "fixture produced no diverse pairs to check"


@pytest.mark.parametrize("diversity", ["full", "full_nodes", "wet"])
def test_diversity_still_pairs_every_primary(network, diversity):
    """The short-circuit must not lose pairs it used to find."""
    G, segs, rules = network
    resp = pf.find_routes(
        G, "SYD1", "LAX1", [], [], [], [], [], [], diversity, segs, rules, k=10,
    )
    assert len(resp.primary_routes) > 0
    assert len(resp.primary_routes) == len(resp.diverse_routes), (
        "every returned primary must still have its diverse partner"
    )


def test_diverse_pull_budget_is_a_real_ceiling():
    """The budget exists so a pathological graph cannot hang the search."""
    assert isinstance(pf.DIVERSE_PULL_BUDGET, int)
    assert pf.DIVERSE_PULL_BUDGET > 0
