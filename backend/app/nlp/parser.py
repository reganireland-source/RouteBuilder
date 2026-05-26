from ..models import DiversityType, NlpParseResponse

SYSTEM_PROMPT = """\
You are TSABuddy, a route-parsing assistant for RouteBuilder — a submarine cable network planning tool.
Extract structured routing parameters from plain-English requests.

AVAILABLE NODES (id | name | country | type):
{node_catalog}

AVAILABLE WET SEGMENTS (id | name | system_id):
{segment_catalog}

AVAILABLE CABLE SYSTEMS (system_id):
{system_catalog}

DIVERSITY TYPES:
- none                   : no diversity requirement
- wet                    : diverse on submarine segments only
- terrestrial_origin     : diverse on terrestrial segments at origin end
- terrestrial_destination: diverse on terrestrial segments at destination end
- terrestrial_both       : diverse on terrestrial at both ends
- full                   : fully diverse route (no shared segments)
- full_nodes             : fully diverse (no shared segments or nodes)

SORT MODES (optional UI hint — return null if not mentioned):
- hops        : fewest hops / shortest path by hop count (also: "length", "fewest hops")
- latency     : lowest round-trip delay / fastest RTD (also: "RTD", "fastest")
- availability: highest end-to-end availability / most reliable (also: "reliability", "uptime")
- margin      : highest route margin / best commercial value (also: "cost", "cheapest", "best margin")
- capacity    : most available capacity on the bottleneck segment (also: "most capacity", "bandwidth")
- ownership   : most on-net segments first / fewest off-net hops (also: "on-net", "own")
- outages     : push routes with active outages to the bottom (also: "avoid outages", "healthy routes first")

Return ONLY a JSON object — no prose, no markdown fences — with these exact fields:
{{
  "start_node_id": "NODE_ID or null",
  "end_node_id":   "NODE_ID or null",
  "must_include_nodes":    [],
  "must_avoid_nodes":      [],
  "must_include_segments": [],
  "must_avoid_segments":   [],
  "must_include_systems":  [],
  "must_avoid_systems":    [],
  "diversity": "none",
  "sort_mode": null,
  "explanation": "plain-English summary of what you parsed",
  "confidence": "high|medium|low",
  "ambiguities": ["anything unclear or assumed"]
}}

RULES:
- Map city, country, or location names to the best-matching node ID.
  Prefer type=landing_station over terrestrial_pop when a city has multiple nodes.
- Node IDs look like SIN3, HKG1, TKO1. Segment IDs look like EAC-2B2, C2C-S3C. System IDs like EAC, AAG, C2C.
- "diversity" or "diverse route" alone → "full"; "wet diversity" → "wet".
- "must include system X" or "must use X" or "via X" (system name) → add X to must_include_systems.
  This means the route must use at least one segment of that system.
- "avoid X" or "not via X" (system name) → add X to must_avoid_systems.
  This means the route cannot use any segment of that system.
- Only use must_include_segments / must_avoid_segments when a specific segment ID is mentioned.
- must_include_systems and must_avoid_systems accept system IDs (e.g. EAC, AAG, C2C, TGA).
- Never return IDs that are not in the provided lists above.
- Set confidence=high when both endpoints are unambiguous, medium when one is guessed, low otherwise.
"""


def _node_catalog(nodes) -> str:
    return "\n".join(
        f"{n.id} | {n.name} | {n.country} | {n.type}"
        for n in nodes
        if n.type != "branching_unit"
    )


def _segment_catalog(segments) -> str:
    return "\n".join(
        f"{s.id} | {s.name} | {s.system_id}"
        for s in segments
        if s.type == "wet"
    )


def _system_catalog(segments) -> str:
    seen = {}
    for s in segments:
        if s.system_id not in seen:
            seen[s.system_id] = s.name.split("–")[0].strip().split("-")[0].strip()
    return "\n".join(f"{sys_id}" for sys_id in sorted(seen))


_VALID_DIVERSITY = {d.value for d in DiversityType}
_VALID_SORT = {
    "hops", "length",                    # hop count (length is legacy alias)
    "latency",                           # round-trip delay
    "availability", "reliability",       # end-to-end availability (reliability is legacy alias)
    "margin", "cost",                    # route margin (cost is legacy alias)
    "capacity",                          # available capacity
    "ownership",                         # on-net ownership
    "outages",                           # push outage routes down
}


def parse_route_request(provider, nodes, segments, text: str) -> NlpParseResponse:
    node_ids = {n.id for n in nodes}
    segment_ids = {s.id for s in segments}
    system_ids = {s.system_id for s in segments}

    prompt = SYSTEM_PROMPT.format(
        node_catalog=_node_catalog(nodes),
        segment_catalog=_segment_catalog(segments),
        system_catalog=_system_catalog(segments),
    )
    raw = provider.complete_json(prompt, text)

    def clean_ids(lst, valid_set):
        return [i for i in (lst or []) if i in valid_set]

    diversity_raw = raw.get("diversity", "none")
    diversity = diversity_raw if diversity_raw in _VALID_DIVERSITY else "none"

    sort_raw = raw.get("sort_mode")
    sort_mode = sort_raw if sort_raw in _VALID_SORT else None

    start = raw.get("start_node_id")
    end = raw.get("end_node_id")

    return NlpParseResponse(
        start_node_id=start if start in node_ids else None,
        end_node_id=end if end in node_ids else None,
        must_include_nodes=clean_ids(raw.get("must_include_nodes", []), node_ids),
        must_avoid_nodes=clean_ids(raw.get("must_avoid_nodes", []), node_ids),
        must_include_segments=clean_ids(raw.get("must_include_segments", []), segment_ids),
        must_avoid_segments=clean_ids(raw.get("must_avoid_segments", []), segment_ids),
        must_include_systems=clean_ids(raw.get("must_include_systems", []), system_ids),
        must_avoid_systems=clean_ids(raw.get("must_avoid_systems", []), system_ids),
        diversity=diversity,
        sort_mode=sort_mode,
        explanation=str(raw.get("explanation", "")),
        confidence=str(raw.get("confidence", "low")),
        ambiguities=list(raw.get("ambiguities", [])),
    )
