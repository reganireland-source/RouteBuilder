"""
research.py — Cable Import Phase 3: aggregate what's known about a named
cable system, then let an LLM extract structured facts from it.

NOT a single-source scraper of submarinenetworks.com. That was the obvious
first choice — it's the standard trade reference for announced cable systems
— but it returns a JS bot-challenge (an `sgcaptcha` redirect) to any
non-browser HTTP client, confirmed live against the real site, not a sandbox
artifact. Getting past that would mean running a real headless browser
server-side (Playwright/Chromium): a genuinely heavy addition — a new system
dependency, 10+ seconds per fetch, real ops/security surface — for one
source that could break its challenge again at any time. Instead this fans
out to whatever public, keyless, non-bot-gated sources are actually
reachable (currently: Wikipedia's public search + summary API, following
its documented rate-limit etiquette — see USER_AGENT) and always falls back
to the LLM's own general knowledge, since a great many notable cable systems
are documented well enough in a model's training data to answer directly
with no fetch at all.

Every fact this produces is a PROPOSAL for the Cable Import wizard's step 1
to pre-fill, same as Phase 1/2 — nothing here writes to the database, and
the wizard's own review/override mechanics are completely unchanged (see
CableImportWizard.tsx's header comment). `confidence`/`notes`/`sources_used`
on CableResearchResult exist so the reviewer knows how much to trust what
came back, not to make the app look more certain than it is.
"""
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from typing import Optional

from ..models import CableResearchResult, ResearchedLandingStation

log = logging.getLogger("routebuilder.cableimport")

# Same convention as app/kml/submarinecablemap.py: real contact info in the
# UA (Wikimedia's API etiquette asks for this — see
# https://meta.wikimedia.org/wiki/User-Agent_policy — and enforces it with a
# 429 for generic/anonymous-looking clients).
_WIKI_UA = (
    "RouteBuilder/1.0 (subsea network planning; "
    "+https://github.com/reganireland-source/RouteBuilder)"
)
_ALLOWED_SCHEMES = ("http", "https")
_WIKI_TIMEOUT = 8.0


def _get_json(url: str) -> Optional[dict]:
    """GET url as JSON, or None on ANY failure. Wikipedia here is a
    best-effort enrichment source, never a hard dependency — a miss just
    means research_cable() falls back to the LLM's own knowledge, not a
    broken feature. This is why, unlike submarinecablemap.py's `_get_json`,
    nothing here raises: there is no caller that needs to distinguish "no
    Wikipedia article" from "Wikipedia was unreachable."""
    scheme = urllib.parse.urlparse(url).scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        return None
    req = urllib.request.Request(  # noqa: S310 — scheme checked above
        url, headers={"User-Agent": _WIKI_UA, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=_WIKI_TIMEOUT) as resp:  # noqa: S310 — scheme checked above
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
        log.info("Wikipedia fetch failed for %s: %s", url, exc)
        return None


def _wikipedia_search_title(cable_name: str) -> Optional[str]:
    """Best-matching Wikipedia article title for a cable system name."""
    query = f"{cable_name} submarine cable"
    url = "https://en.wikipedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query", "list": "search", "srsearch": query,
        "format": "json", "srlimit": 1,
    })
    data = _get_json(url)
    hits = (data or {}).get("query", {}).get("search", [])
    return hits[0]["title"] if hits else None


def _wikipedia_extract(title: str) -> Optional[str]:
    """Plain-text summary for a known Wikipedia title."""
    url = "https://en.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"))
    data = _get_json(url)
    extract = (data or {}).get("extract")
    return extract or None


def gather_wikipedia_context(cable_name: str) -> Optional[dict]:
    """{'title', 'extract', 'url'} for the best-matching Wikipedia article,
    or None if nothing was found or reachable."""
    title = _wikipedia_search_title(cable_name)
    if not title:
        return None
    extract = _wikipedia_extract(title)
    if not extract:
        return None
    return {
        "title": title,
        "extract": extract,
        "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
    }


_SYSTEM_PROMPT_TEMPLATE = """\
You are a submarine cable research assistant for RouteBuilder, a subsea \
network planning tool. The user is adding a named submarine cable system \
that this organisation does NOT own to the tool, purely for reference and \
competitive tracking — not to operate it.

{source_block}

Return ONLY a JSON object — no prose, no markdown fences — with these exact fields:
{{
  "description": "one or two sentence factual description of the cable system",
  "consortium_owners": ["operator name", ...],
  "fiber_pair_count": <integer or null>,
  "rfs_status": "in_service" or "planned",
  "rfs_quarter": "YYYY-QN or null (only when rfs_status is planned and you have a real date)",
  "landing_stations": [
    {{"name": "landing station or city name", "city": "city or null", "country": "ISO-2 country code or null", "lat": <approximate decimal degrees or null>, "lng": <approximate decimal degrees or null>}}
  ],
  "confidence": "high|medium|low",
  "notes": "anything the reviewer should double-check, e.g. 'no source article found, based on general knowledge only' or 'fibre pair count not publicly disclosed'"
}}

RULES:
- List landing stations in a sensible geographic order — the order drives how the reviewing tool proposes to chop the cable into segments.
- lat/lng are ROUGH city-centre approximations only, to help place a marker — never present them as surveyed.
- If you are not confident a fact is real, prefer null/empty over guessing, and say so in "notes".
- confidence=high only when you have real source text covering most fields; confidence=low when relying mostly on general knowledge, or the cable is obscure/very new.
"""


def _source_block(cable_name: str, wiki: Optional[dict]) -> tuple[str, list[str]]:
    if wiki:
        block = (
            f'SOURCE TEXT (Wikipedia: "{wiki["title"]}", {wiki["url"]}):\n{wiki["extract"]}\n\n'
            "Extract facts from this source text where it covers them. Where it is silent on a "
            "field, you may draw on your own general knowledge of this cable system if you have "
            "genuine, specific knowledge of it — but say so in \"notes\", and never invent a fact "
            "you are not reasonably confident is true."
        )
        return block, ["wikipedia"]
    block = (
        f'No source article was found for "{cable_name}". Answer from your own general knowledge '
        "of this cable system if you have genuine, specific knowledge of it. If you do not "
        "recognise this cable at all, return mostly null/empty fields and say so plainly in "
        '"notes" rather than inventing details.'
    )
    return block, ["model_knowledge"]


def _clean_owners(raw) -> list[str]:
    return [str(x).strip() for x in (raw or []) if str(x).strip()][:20]


def _clean_landing(item) -> Optional[ResearchedLandingStation]:
    if not isinstance(item, dict) or not item.get("name"):
        return None
    lat, lng = item.get("lat"), item.get("lng")
    return ResearchedLandingStation(
        name=str(item["name"])[:120],
        city=str(item["city"])[:80] if item.get("city") else None,
        country=str(item["country"]).upper()[:2] if item.get("country") else None,
        lat=float(lat) if isinstance(lat, (int, float)) and -90 <= lat <= 90 else None,
        lng=float(lng) if isinstance(lng, (int, float)) and -180 <= lng <= 180 else None,
    )


def _clean_landings(raw) -> list[ResearchedLandingStation]:
    out = []
    for item in (raw or [])[:40]:
        cleaned = _clean_landing(item)
        if cleaned:
            out.append(cleaned)
    return out


def _clean_fiber_pair_count(raw) -> Optional[int]:
    if isinstance(raw, (int, float)) and raw >= 0:
        return int(raw)
    return None


def research_cable(provider, cable_name: str) -> CableResearchResult:
    """Gather whatever's reachable about `cable_name` and ask `provider`
    (any LLMProvider — see app/nlp/provider.py) to extract structured facts.
    Never raises for "nothing found" — that just becomes a low-confidence,
    mostly-empty result with an explanatory note; only a genuine provider/
    network failure propagates, for the caller to turn into a 500."""
    wiki = gather_wikipedia_context(cable_name)
    source_block, sources_used = _source_block(cable_name, wiki)

    prompt = _SYSTEM_PROMPT_TEMPLATE.format(source_block=source_block)
    raw = provider.complete_json(prompt, f"Research the submarine cable system: {cable_name}")

    rfs_status = raw.get("rfs_status")
    rfs_status = rfs_status if rfs_status in ("in_service", "planned") else "planned"
    confidence = raw.get("confidence")
    confidence = confidence if confidence in ("high", "medium", "low") else "low"

    return CableResearchResult(
        cable_name=cable_name,
        description=str(raw.get("description", ""))[:2000],
        consortium_owners=_clean_owners(raw.get("consortium_owners")),
        fiber_pair_count=_clean_fiber_pair_count(raw.get("fiber_pair_count")),
        rfs_status=rfs_status,
        rfs_quarter=str(raw["rfs_quarter"]) if rfs_status == "planned" and raw.get("rfs_quarter") else None,
        landing_stations=_clean_landings(raw.get("landing_stations")),
        sources_used=sources_used,
        confidence=confidence,
        notes=str(raw.get("notes", ""))[:1000],
    )
