"""
KMZ/KML parsing — turn an uploaded file into cable paths we can draw.

WHAT THIS HANDLES. A KMZ is a ZIP containing a .kml (plus any icons/overlays);
a .kml is that XML on its own. Both arrive here. Inside, the geometry we care
about is LineStrings — one per cable path — which may sit at the top level, in
a <Folder>, inside a <MultiGeometry>, or under a <gx:Track>. A file may hold
exactly one path (one segment) or many (a whole system), and both are normal,
so this always returns a LIST and lets the caller decide what to do with it.
Placemark Points (beach manholes, repeaters, KP marks) are parsed and returned
too — stored against the segment, not drawn today.

THIS FILE TREATS ITS INPUT AS HOSTILE, and the reasons are not theoretical:

  * ZIP BOMB. A KMZ is a ZIP, so a few hundred KB can declare gigabytes of
    output. Every entry's declared size is checked BEFORE extraction and the
    running total is capped, so a bomb is refused rather than read.
  * ZIP PATH TRAVERSAL. Entry names can contain `..` or absolute paths. We
    never write entries to disk — only read the one .kml into memory — but the
    name is still validated so that stays true if someone later adds caching.
  * XML ENTITY EXPANSION ("billion laughs"). Python's own docs say
    xml.etree.ElementTree is vulnerable to it, and that is not theoretical:
    measured against this parser, each nesting level multiplied the output by
    ten, so a ~500-byte file with nine levels expands to a gigabyte in memory
    before any of our own limits are reached. The fix is to REFUSE ANY DOCTYPE
    outright, before parsing. KML has no legitimate use for a DTD internal
    subset — Google Earth does not emit one — so rejecting it costs nothing and
    removes the whole class, entity expansion and external entities together.
    That guard is dependency-free and always runs; defusedxml is used as well
    when installed, as a second line rather than the only one.
  * COORDINATE COUNT. A survey-grade route can carry hundreds of thousands of
    points. Parsing is capped so one file cannot exhaust memory; simplification
    for display happens later, in simplify.py.

Admin auth already stands in front of every upload endpoint, so none of this is
the only line of defence — but "only admins can reach it" is an argument for
why a bug here is unlikely to be exploited, not for why the bug should exist.

Pure functions, no I/O beyond reading the bytes handed in, and no database or
model imports — which is what lets the whole thing be tested against fixtures.
"""
from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional

# Prefer defusedxml; fall back to a hardened stdlib parser. Either way entity
# expansion is off — see the module docstring.
try:
    from defusedxml.ElementTree import fromstring as _xml_fromstring  # type: ignore
    XML_HARDENED_BY = "defusedxml"
except ImportError:  # pragma: no cover - depends on the deployed env
    import xml.etree.ElementTree as _ET

    def _xml_fromstring(text: str):
        # A fresh parser per call. entity={} means any custom entity reference
        # raises rather than expanding, which is the billion-laughs vector.
        parser = _ET.XMLParser()
        try:
            parser.parser.DefaultHandlerExpand = lambda *_a, **_k: None
            parser.entity = {}
        except AttributeError:
            pass
        return _ET.fromstring(text, parser=parser)

    XML_HARDENED_BY = "stdlib-restricted"


# ── Limits ───────────────────────────────────────────────────────────────────
#: Largest single upload we accept, matching the outage parser's existing cap.
MAX_FILE_BYTES = 25 * 1024 * 1024
#: Largest total we will decompress out of one KMZ. A real cable KMZ is a few
#: hundred KB of XML; 200MB is far past any legitimate file and far short of
#: what a bomb wants.
MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024
#: Refuse absurd compression ratios even under the byte cap.
MAX_COMPRESSION_RATIO = 1000
#: Most coordinate pairs we will read from one document.
MAX_TOTAL_COORDS = 2_000_000
#: A path needs two distinct ends to be a path.
MIN_PATH_POINTS = 2


class KmlParseError(ValueError):
    """The file could not be read as KMZ/KML. Message is shown to the user."""


@dataclass
class KmlPath:
    """One LineString: a cable path, with where it came from inside the file."""
    name: str
    #: [[lat, lng], ...] — note the ORDER SWAP from KML's own lng,lat,alt.
    coords: list[list[float]]
    folder: Optional[str] = None
    description: Optional[str] = None
    #: Altitudes as given, when the file carries them. For a subsea route these
    #: are usually negative (depth). Kept because throwing away survey depth is
    #: not recoverable; not used for drawing.
    altitudes: list[float] = field(default_factory=list)


@dataclass
class KmlPoint:
    """A placemark point — BMH, repeater, branching unit, KP mark."""
    name: str
    lat: float
    lng: float
    folder: Optional[str] = None
    description: Optional[str] = None


@dataclass
class ParsedKml:
    """Everything we took out of one uploaded file."""
    paths: list[KmlPath]
    points: list[KmlPoint]
    #: Name of the .kml entry inside a KMZ, or the filename for a bare .kml.
    source_name: str
    #: <Document><name> when present — often the system name, used for matching.
    document_name: Optional[str] = None


# ── KMZ container ────────────────────────────────────────────────────────────

def _unsafe_zip_name(name: str) -> bool:
    """Absolute paths and parent-directory escapes."""
    if name.startswith("/") or name.startswith("\\"):
        return True
    if re.match(r"^[A-Za-z]:", name):
        return True
    return ".." in name.replace("\\", "/").split("/")


def extract_kml_bytes(data: bytes, filename: str = "") -> tuple[bytes, str]:
    """
    Return (kml_xml_bytes, entry_name) from a .kmz or a bare .kml.

    Raises KmlParseError with a message meant for the uploader.
    """
    if len(data) > MAX_FILE_BYTES:
        raise KmlParseError(
            f"File is {len(data) / 1_048_576:.1f} MB; the limit is "
            f"{MAX_FILE_BYTES // 1_048_576} MB."
        )
    if not data:
        raise KmlParseError("File is empty.")

    # A KMZ is a ZIP ("PK\x03\x04"); anything else is treated as raw KML.
    if not data[:2] == b"PK":
        return data, filename or "(inline kml)"

    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise KmlParseError(f"Not a readable KMZ archive: {exc}") from exc

    with zf:
        total = 0
        for info in zf.infolist():
            if _unsafe_zip_name(info.filename):
                raise KmlParseError(f"Archive entry has an unsafe path: {info.filename!r}")
            total += info.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise KmlParseError(
                    "Archive expands to more than "
                    f"{MAX_UNCOMPRESSED_BYTES // 1_048_576} MB — refusing to read it."
                )
            if info.compress_size > 0 and info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise KmlParseError(
                    f"Archive entry {info.filename!r} has an implausible compression "
                    "ratio — refusing to read it."
                )

        names = [n for n in zf.namelist() if n.lower().endswith(".kml") and not _unsafe_zip_name(n)]
        if not names:
            raise KmlParseError("KMZ contains no .kml file.")
        # Google Earth writes doc.kml; prefer it, else the first (shallowest).
        preferred = next((n for n in names if n.lower().endswith("doc.kml")), None)
        entry = preferred or sorted(names, key=lambda n: (n.count("/"), n))[0]
        return zf.read(entry), entry


# ── KML XML ──────────────────────────────────────────────────────────────────

def _localname(tag: str) -> str:
    """Strip the XML namespace: '{http://...}Placemark' -> 'Placemark'."""
    return tag.rpartition("}")[2]


def _text(el, child: str) -> Optional[str]:
    """The stripped text of `el`'s first direct child named `child`
    (namespace-agnostic), or None if absent/blank — used to pull <name>,
    <description> and <coordinates> out of a Placemark/geometry element."""
    for sub in el:
        if _localname(sub.tag) == child and sub.text:
            stripped = sub.text.strip()
            if stripped:
                return stripped
    return None


def parse_coordinates(raw: str, budget: list[int]) -> tuple[list[list[float]], list[float]]:
    """
    Parse a KML <coordinates> blob into ([[lat, lng], ...], [alt, ...]).

    KML writes `lng,lat[,alt]` — LONGITUDE FIRST. Everything else in this
    codebase is [lat, lng], so the swap happens here, once, rather than being
    remembered at each call site. Tuples are whitespace-separated; real files
    freely mix spaces, newlines and tabs, and often indent every point.

    `budget` is a single-element list acting as a shared mutable counter across
    every coordinate blob in one document, so a file cannot evade MAX_TOTAL_COORDS
    by splitting one huge path into many.
    """
    coords: list[list[float]] = []
    alts: list[float] = []
    for token in raw.split():
        parts = token.split(",")
        if len(parts) < 2:
            continue
        try:
            lng = float(parts[0])
            lat = float(parts[1])
            alt = float(parts[2]) if len(parts) > 2 and parts[2] != "" else 0.0
        except ValueError:
            continue
        # Silently dropping out-of-range coordinates would draw a cable through
        # the wrong hemisphere; they are skipped and the caller sees a short path.
        if not (-90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0):
            continue
        coords.append([lat, lng])
        alts.append(alt)
        budget[0] -= 1
        if budget[0] <= 0:
            raise KmlParseError(
                f"File contains more than {MAX_TOTAL_COORDS:,} coordinates — refusing to read it."
            )
    return coords, alts


def _dedupe_consecutive(coords: list[list[float]]) -> list[list[float]]:
    """Drop repeated identical points, which KML exporters emit freely."""
    out: list[list[float]] = []
    for c in coords:
        if not out or out[-1][0] != c[0] or out[-1][1] != c[1]:
            out.append(c)
    return out


#: How far into the document to look for a DOCTYPE. It must legally precede the
#: root element, so a generous prefix is enough and we never scan a whole file.
_DOCTYPE_SCAN_BYTES = 8192
_DOCTYPE_RE = re.compile(rb"<!DOCTYPE", re.IGNORECASE)


def _reject_doctype(xml_bytes: bytes) -> None:
    """
    Refuse any document carrying a DTD. See the module docstring: this is the
    guard that actually stops billion-laughs, and it runs whether or not
    defusedxml is installed.
    """
    if _DOCTYPE_RE.search(xml_bytes[:_DOCTYPE_SCAN_BYTES]):
        raise KmlParseError(
            "File declares a DOCTYPE. KML does not need one, and it is the "
            "vector for entity-expansion attacks, so it is refused. Re-export "
            "the file from your mapping tool and it will not contain one."
        )


def parse_kml(xml_bytes: bytes, source_name: str = "") -> ParsedKml:
    """
    Read KML XML into paths and points.

    Walks the whole tree rather than matching fixed paths, because real files
    nest Placemarks under arbitrarily deep <Folder> and <Document> structures
    and there is no reliable shape to assume. Folder names are carried down so
    a multi-path file can say which path came from where — that is what the
    matcher uses to tell one segment's path from another's.
    """
    _reject_doctype(xml_bytes)
    try:
        root = _xml_fromstring(xml_bytes.decode("utf-8", errors="replace"))
    except KmlParseError:
        raise
    except Exception as exc:  # defusedxml raises its own types
        raise KmlParseError(f"File is not readable XML: {exc}") from exc

    paths: list[KmlPath] = []
    points: list[KmlPoint] = []
    budget = [MAX_TOTAL_COORDS]
    document_name: Optional[str] = None

    def walk(el, folder: Optional[str]) -> None:
        nonlocal document_name
        tag = _localname(el.tag)

        if tag in ("Document", "Folder"):
            name = _text(el, "name")
            if tag == "Document" and document_name is None and name:
                document_name = name
            for child in el:
                walk(child, name or folder)
            return

        if tag == "Placemark":
            pm_name = _text(el, "name") or ""
            pm_desc = _text(el, "description")
            _collect_geometry(el, pm_name, pm_desc, folder)
            return

        for child in el:
            walk(child, folder)

    def _collect_geometry(el, pm_name: str, pm_desc: Optional[str], folder: Optional[str]) -> None:
        """Pull every LineString/Track/Point out of one Placemark's subtree."""
        for sub in el.iter():
            sub_tag = _localname(sub.tag)
            if sub_tag in ("LineString", "LinearRing", "Track"):
                raw = _text(sub, "coordinates")
                if raw:
                    coords, alts = parse_coordinates(raw, budget)
                    coords = _dedupe_consecutive(coords)
                    if len(coords) >= MIN_PATH_POINTS:
                        paths.append(KmlPath(
                            name=pm_name, coords=coords, folder=folder,
                            description=pm_desc,
                            altitudes=alts[:len(coords)] if any(alts) else [],
                        ))
                else:
                    # <gx:Track> carries <gx:coord> children ("lng lat alt"),
                    # not a <coordinates> blob.
                    track = [c for c in sub if _localname(c.tag) == "coord" and c.text]
                    if track:
                        joined = " ".join(",".join(c.text.split()) for c in track)
                        coords, alts = parse_coordinates(joined, budget)
                        coords = _dedupe_consecutive(coords)
                        if len(coords) >= MIN_PATH_POINTS:
                            paths.append(KmlPath(
                                name=pm_name, coords=coords, folder=folder, description=pm_desc,
                                altitudes=alts[:len(coords)] if any(alts) else [],
                            ))
            elif sub_tag == "Point":
                raw = _text(sub, "coordinates")
                if raw:
                    coords, _ = parse_coordinates(raw, budget)
                    if coords:
                        points.append(KmlPoint(
                            name=pm_name, lat=coords[0][0], lng=coords[0][1],
                            folder=folder, description=pm_desc,
                        ))

    walk(root, None)
    return ParsedKml(
        paths=paths, points=points,
        source_name=source_name, document_name=document_name,
    )


def parse_upload(data: bytes, filename: str) -> ParsedKml:
    """Read an uploaded .kmz or .kml. The one entry point callers need."""
    xml_bytes, entry = extract_kml_bytes(data, filename)
    parsed = parse_kml(xml_bytes, source_name=entry)
    if not parsed.paths:
        raise KmlParseError(
            "No cable path found. The file parsed, but it contains no LineString "
            "geometry — only points or overlays."
        )
    return parsed
