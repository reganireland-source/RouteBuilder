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

AVAILABLE COUNTRIES (ISO code, node count):
{country_catalog}

DIVERSITY TYPES:
- none                   : no diversity requirement
- wet                    : diverse on submarine segments only
- terrestrial_origin     : diverse on terrestrial segments at origin end
- terrestrial_destination: diverse on terrestrial segments at destination end
- terrestrial_both       : diverse on terrestrial at both ends
- full                   : fully diverse route (no shared segments)
- full_nodes             : fully diverse (no shared segments or nodes)

HOW THE SEARCH PIPELINE WORKS — this determines which field to use:

  STEP 2 — HARD CONSTRAINTS (routes that break these are permanently removed):
  • must_include_nodes / must_avoid_nodes   — force or forbid specific transit nodes
  • must_include_segments / must_avoid_segments — force or forbid specific cable segments
  • must_include_systems / must_avoid_systems   — force or forbid entire cable systems
  • max_wet_hops         — cap on submarine cable segments (integer ≥ 1); null = unconstrained
  • max_terrestrial_hops — cap on land cable segments (integer ≥ 1); null = unconstrained
  • must_include_countries — ISO codes of countries the route MUST pass through (at least one landing node)
  • must_avoid_countries   — ISO codes of countries the route must NOT pass through (any transit node)

  STEP 3 — POOL SELECTION via optimise_for (which 30 routes enter the memory pool):
  When set, ALL 30 pool slots are filled with the best routes for that single dimension.
  Use for strong user intent: "optimise for", "prioritise", "I need the best X routes".
  Valid values: "hops" | "distance" | "latency" | "margin" | "capacity" | "ownership" | "outages"

  STEP 4 — DISPLAY SORT via sort_mode (which 5 of the 30 are shown, and in what order):
  A lightweight display preference — no routes are removed, only the top-5 display order changes.
  Use for: "sort by", "show me ranked by", "order by", "push outages down".
  Valid values: "hops" | "distance" | "latency" | "availability" | "margin" | "capacity" | "ownership" | "outages"

CHOOSING optimise_for vs sort_mode:
- "optimise for latency" / "focus on capacity" / "I need the highest-margin routes" → optimise_for
- "sort by latency" / "show me ranked by distance" / "order by margin" → sort_mode
- "avoid outages" / "healthy routes first" / "no outages" → optimise_for: "outages" (filters pool to outage-free routes)
- "push outages down" / "show outage routes last" → sort_mode: "outages" (keeps outage routes but shows them last)
- "most reliable" / "highest availability" → sort_mode: "availability" (availability is NOT valid for optimise_for)
- When ambiguous, use optimise_for for strong commercial intent, sort_mode for a mild display preference
- You may set BOTH if the user wants a specific pool AND a different display order
  e.g. "optimise for margin, then sort by latency" → optimise_for: "margin", sort_mode: "latency"

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
  "must_include_countries": [],
  "must_avoid_countries":   [],
  "diversity": "none",
  "max_wet_hops": null,
  "max_terrestrial_hops": null,
  "optimise_for": null,
  "sort_mode": null,
  "explanation": "plain-English summary of what you parsed and why",
  "confidence": "high|medium|low",
  "ambiguities": ["anything unclear or assumed"]
}}

RULES:
- Map city, country, or location names to the best-matching node ID.
  Prefer type=landing_station over terrestrial_pop when a city has multiple nodes.
- Node IDs look like SIN3, HKG1, TKO1. Segment IDs look like EAC-2B2, C2C-S3C. System IDs like EAC, AAG, C2C.
- "diversity" or "diverse route" alone → "full"; "wet diversity" → "wet".
- "must include system X" or "must use X" or "via X" (system name) → must_include_systems.
- "avoid X" or "not via X" (system name) → must_avoid_systems.
- Only use must_include_segments / must_avoid_segments when a specific segment ID is mentioned.
- "max N wet hops" / "no more than N submarine segments" / "single wet hop" → max_wet_hops: N
- "max N terrestrial hops" / "limit land segments to N" → max_terrestrial_hops: N
- COUNTRY CONSTRAINTS (IMPORTANT — take priority over node-level avoidance):
  When the user mentions avoiding or requiring a COUNTRY (not a specific node), ALWAYS use
  must_avoid_countries / must_include_countries with the ISO code. NEVER enumerate individual
  node IDs from that country in must_avoid_nodes — that is fragile and incomplete.
  Examples: "avoiding taiwan" → must_avoid_countries: ["TW"]  (NOT must_avoid_nodes: ["TPE1","TPE2",...])
            "avoid china" → must_avoid_countries: ["CN"]
            "must land in japan" → must_include_countries: ["JP"]
            "route via philippines" → must_include_countries: ["PH"]
- Country codes: AE=UAE, AU=Australia, CN=China, DE=Germany, DJ=Djibouti, EG=Egypt, FJ=Fiji, FR=France, GB=United Kingdom, GR=Greece, GU=Guam, HK=Hong Kong, ID=Indonesia, IN=India, IT=Italy, JP=Japan, KH=Cambodia, KR=South Korea, LK=Sri Lanka, MM=Myanmar, MP=Northern Mariana Islands, MY=Malaysia, NZ=New Zealand, OM=Oman, PH=Philippines, PK=Pakistan, QA=Qatar, SA=Saudi Arabia, SG=Singapore, TH=Thailand, TW=Taiwan, US=United States, VN=Vietnam, VU=Vanuatu, YE=Yemen
- Only use must_avoid_nodes / must_include_nodes when the user names a SPECIFIC node, facility, or PoP by name or ID.
- Never return IDs that are not in the provided lists above.
- Set confidence=high when both endpoints are unambiguous, medium when one is guessed, low otherwise.
- In your explanation, briefly state what constraints are hard filters vs pool/sort preferences.
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


def _country_catalog(nodes) -> str:
    from collections import Counter
    counts = Counter(n.country for n in nodes if n.type != "branching_unit")
    return "\n".join(f"{code} ({count} nodes)" for code, count in sorted(counts.items()))


_VALID_DIVERSITY = {d.value for d in DiversityType}
_VALID_SORT = {
    "hops", "distance", "length", "latency",
    "availability", "reliability",
    "margin", "cost", "capacity", "ownership", "outages",
}
_VALID_OPTIMISE_FOR = {
    "hops", "distance", "length", "latency",
    "margin", "cost", "capacity", "ownership", "outages",
}


def parse_route_request(provider, nodes, segments, text: str) -> NlpParseResponse:
    node_ids = {n.id for n in nodes}
    segment_ids = {s.id for s in segments}
    system_ids = {s.system_id for s in segments}
    valid_countries = {n.country for n in nodes if n.type != "branching_unit"}

    prompt = SYSTEM_PROMPT.format(
        node_catalog=_node_catalog(nodes),
        segment_catalog=_segment_catalog(segments),
        system_catalog=_system_catalog(segments),
        country_catalog=_country_catalog(nodes),
    )
    raw = provider.complete_json(prompt, text)

    def clean_ids(lst, valid_set):
        return [i for i in (lst or []) if i in valid_set]

    diversity_raw = raw.get("diversity", "none")
    diversity = diversity_raw if diversity_raw in _VALID_DIVERSITY else "none"

    sort_raw = raw.get("sort_mode")
    sort_mode = sort_raw if sort_raw in _VALID_SORT else None

    optimise_raw = raw.get("optimise_for")
    optimise_for = optimise_raw if optimise_raw in _VALID_OPTIMISE_FOR else None

    def _clean_hop(val) -> "int | None":
        if isinstance(val, (int, float)) and val >= 1:
            return int(val)
        return None

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
        must_include_countries=clean_ids(raw.get("must_include_countries", []), valid_countries),
        must_avoid_countries=clean_ids(raw.get("must_avoid_countries", []), valid_countries),
        diversity=diversity,
        max_wet_hops=_clean_hop(raw.get("max_wet_hops")),
        max_terrestrial_hops=_clean_hop(raw.get("max_terrestrial_hops")),
        optimise_for=optimise_for,
        sort_mode=sort_mode,
        explanation=str(raw.get("explanation", "")),
        confidence=str(raw.get("confidence", "low")),
        ambiguities=list(raw.get("ambiguities", [])),
    )
