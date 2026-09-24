"""
submarinecablemap.py — fetch cable geometry from submarinecablemap.com's public
map data, and turn it into the same shape an uploaded KML would produce.

WHY THIS EXISTS. A lot of real-world KMLs handed to this app are messy: chopped
into dozens of unrelated survey-run fragments, missing entirely for a cable
nobody ever exported, or simply lost. submarinecablemap.com already draws every
public submarine cable, and its API is open. It is NOT survey data — TERMS below
covers what it actually is — but "a public map's trace of the cable" is real
signal, strictly better than the straight-line/waypoint approximation this app
falls back to today, and it is retrievable for any of ~700 cables with no
carrier relationship required.

WHAT THE API ACTUALLY OFFERS. There is no downloadable .kmz per cable — the
"KMZ retrievable from there" question this module answers is "not literally,
but the same geometry, yes." `cable/cable-geo.json` is one 700+ KB GeoJSON file
covering every cable at once: real signed lon/lat, one Feature per cable
usually, but sometimes several (features `echo-0`, `echo-1`, `echo-2` for one
cable), and a Feature's own MultiLineString can hold several disjoint pieces —
a landing station drawn as a short spur, an unrelated stretch the map's own
export chopped for its own reasons. In other words: EXACTLY the "many
fragments, one cable, needs joining and splitting" shape this app already has a
whole pipeline for (joiner.py -> splitter.py -> matcher.py). So this module's
only job is turning what the API returns into a KML byte string; every fragment
gets reassembled and matched to segments by the SAME code an upload goes
through, not a parallel copy of it.

FIDELITY. Measured against a few real cables: 6-30 vertices per piece, visibly
simplified for a web map rather than following the seabed. That is why every
route synced this way is stored with source='submarinecablemap', never
'upload' — see segment_kml migration m062 — and is never drawn, exported, or
labelled as "surveyed" anywhere downstream. It is offered as a starting point
better than a straight line, not a substitute for a carrier's as-laid route.

CACHING. cable-geo.json is fetched once and cached to disk for CACHE_TTL_SECONDS
(the whole file, not per-cable — there is no per-cable endpoint for it) because
it is ~700 KB of public, slow-changing reference data and this app has no
reason to refetch it on every propose call. A fetch failure serves the stale
cache rather than failing outright, on the theory that yesterday's cable route
is a far better answer than none; failing only when there is no cache at all.

Follows the same conventions as hazards/sources.py: urllib.request rather than
a new HTTP dependency, a real User-Agent (Cloudflare in front of a lot of sites
quietly 403s the default one), and a scheme allowlist so a misconfigured base
URL cannot turn this into a local file read.
"""
from __future__ import annotations

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from ..data_loader import DATA_DIR

log = logging.getLogger("routebuilder.kml.scm")

SCM_BASE = "https://www.submarinecablemap.com/api/v3"
CABLE_LIST_URL = f"{SCM_BASE}/cable/all.json"
CABLE_GEO_URL = f"{SCM_BASE}/cable/cable-geo.json"

#: Disk cache for the two files above. Public reference data, not customer
#: data, but still not something to commit — gitignored alongside kml/.
CACHE_DIR = DATA_DIR / "scm_cache"
CACHE_TTL_SECONDS = 12 * 60 * 60

USER_AGENT = "RouteBuilder/1.0 (subsea network planning; +https://github.com/reganireland-source/RouteBuilder)"
ALLOWED_SCHEMES = ("http", "https")
_REQUEST_TIMEOUT = 30.0

#: A path this app draws or exports must say what it is. Carried into every
#: synced KML's own Document description too, so the fact survives even if
#: someone downloads the original file straight from the library.
FIDELITY_NOTE = (
    "Fetched from submarinecablemap.com's public map data, not a carrier "
    "survey. Simplified for a web map (tens of points per cable, not "
    "thousands) — treat as a starting point, not an as-laid route."
)


class ScmError(RuntimeError):
    """Upstream could not be read, or the cable id is unknown. User-safe message."""


def _cache_path(name: str) -> Path:
    """Filesystem path for a cached response, creating CACHE_DIR if needed."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / name


def _get_json(url: str) -> Any:
    """Fetch and JSON-decode `url`, with a scheme allowlist (see module
    docstring), a real User-Agent, and a request timeout. Raises ScmError
    (never a raw urllib/json exception) on any failure, so callers only have
    one exception type to handle."""
    scheme = urllib.parse.urlparse(url).scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise ScmError(f"refusing to fetch a {scheme or 'schemeless'} URL")
    req = urllib.request.Request(  # noqa: S310 — scheme checked above
        url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT) as resp:  # noqa: S310 — scheme checked above
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise ScmError(f"submarinecablemap.com returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ScmError(f"could not reach submarinecablemap.com: {exc.reason}") from exc
    except (TimeoutError, json.JSONDecodeError) as exc:
        raise ScmError(f"bad response from submarinecablemap.com: {type(exc).__name__}") from exc


def _cached_json(url: str, cache_name: str, *, force_refresh: bool = False) -> Any:
    """
    Serve `url` from a disk cache, refreshing it when stale.

    A fetch failure falls back to whatever is cached, however old, and only
    raises when there is nothing on disk at all — see the module docstring.
    """
    path = _cache_path(cache_name)
    fresh = path.exists() and (time.time() - path.stat().st_mtime) < CACHE_TTL_SECONDS
    if fresh and not force_refresh:
        try:
            return json.loads(path.read_text())
        except (json.JSONDecodeError, OSError):
            pass  # corrupt cache: fall through and refetch

    try:
        data = _get_json(url)
    except ScmError:
        if path.exists():
            log.warning("submarinecablemap.com fetch failed; serving stale cache for %s", cache_name)
            try:
                return json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                pass
        raise

    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data))
    tmp.replace(path)  # atomic — never leave a half-written cache file
    return data


def list_cables(*, force_refresh: bool = False) -> list[dict[str, str]]:
    """Every cable submarinecablemap.com knows about, id + name, name-sorted."""
    data = _cached_json(CABLE_LIST_URL, "all.json", force_refresh=force_refresh)
    cables = [{"id": c["id"], "name": c["name"]} for c in data if c.get("id") and c.get("name")]
    cables.sort(key=lambda c: c["name"].lower())
    return cables


def search_cables(query: str, limit: int = 25) -> list[dict[str, str]]:
    """
    Cables whose name contains `query`, case-insensitive.

    Name-starts-with ranks above name-contains, so typing "AAG" surfaces
    "AAG Cable System" before something that merely mentions AAG in passing.
    An empty query returns the first `limit` cables alphabetically rather than
    everything, so the picker has something to show before anyone types.
    """
    cables = list_cables()
    q = query.strip().lower()
    if not q:
        return cables[:limit]
    starts = [c for c in cables if c["name"].lower().startswith(q)]
    contains = [c for c in cables if c not in starts and q in c["name"].lower()]
    return (starts + contains)[:limit]


def _geo_features_for(cable_id: str, *, force_refresh: bool = False) -> list[dict]:
    """GeoJSON Features for one cable out of the whole cable-geo.json
    collection — usually one, sometimes several (see module docstring on
    why one cable id can own multiple features)."""
    data = _cached_json(CABLE_GEO_URL, "cable-geo.json", force_refresh=force_refresh)
    return [f for f in data.get("features", []) if (f.get("properties") or {}).get("id") == cable_id]


def _esc(s: str) -> str:
    """XML-escape. Mirrors frontend/src/utils/generateKml.ts's esc()."""
    return (
        s.replace("&", "&amp;").replace("<", "&lt;")
        .replace(">", "&gt;").replace('"', "&quot;")
    )


def _coords_to_kml(coords: list[list[float]]) -> str:
    """[[lng, lat], ...] (GeoJSON order, already real signed longitude) -> KML's
    own `lng,lat,alt` tuples. No Pacific-normalisation to undo here — this data
    never passed through this app's map projection in the first place."""
    return " ".join(f"{lng:.6f},{lat:.6f},0" for lng, lat in coords)


def cable_to_kml_bytes(cable_id: str, cable_name: str) -> bytes:
    """
    Build a KML document from one cable's fetched GeoJSON pieces.

    One Placemark per LineString piece — a Feature's MultiLineString may hold
    several, and a cable may have several Features — so a cable chopped into
    twenty disjoint pieces by the source map arrives here exactly as twenty
    Placemarks, ready for the SAME join -> split -> match pipeline an uploaded
    file goes through. Nothing here decides which piece belongs to which
    segment; that is matcher.py's job, unchanged.

    Raises ScmError if the cable id is unknown or carries no LineString data.
    """
    features = _geo_features_for(cable_id)
    if not features:
        raise ScmError(f"No geometry found on submarinecablemap.com for cable {cable_id!r}")

    placemarks: list[str] = []
    piece_no = 0
    for feature in features:
        geom = feature.get("geometry") or {}
        if geom.get("type") != "MultiLineString":
            continue
        for coords in geom.get("coordinates") or []:
            if len(coords) < 2:
                continue
            piece_no += 1
            placemarks.append(
                f"      <Placemark>\n"
                f"        <name>{_esc(cable_name)} part {piece_no}</name>\n"
                f"        <LineString><coordinates>{_coords_to_kml(coords)}"
                f"</coordinates></LineString>\n"
                f"      </Placemark>"
            )

    if not placemarks:
        raise ScmError(f"Cable {cable_id!r} has no usable LineString geometry")

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n'
        "  <Document>\n"
        f"    <name>{_esc(cable_name)}</name>\n"
        f"    <description>{_esc(FIDELITY_NOTE)}</description>\n"
        "    <Folder>\n"
        f"      <name>{_esc(cable_name)}</name>\n"
        + "\n".join(placemarks) + "\n"
        "    </Folder>\n"
        "  </Document>\n"
        "</kml>\n"
    )
    return xml.encode("utf-8")


def fetch_cable_kml(cable_id: str) -> tuple[bytes, str, str]:
    """
    (kml_bytes, filename, cable_name) for one cable, or raises ScmError.

    The one entry point callers need — resolves the name, builds the
    synthetic KML, and hands back a (bytes, filename) pair that is a drop-in
    for what parse_upload() normally receives from a real file.
    """
    cable = next((c for c in list_cables() if c["id"] == cable_id), None)
    if cable is None:
        raise ScmError(f"Unknown submarinecablemap.com cable id {cable_id!r}")
    kml_bytes = cable_to_kml_bytes(cable_id, cable["name"])
    return kml_bytes, f"submarinecablemap-{cable_id}.kml", cable["name"]
