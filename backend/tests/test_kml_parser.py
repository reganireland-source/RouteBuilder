"""
KMZ/KML parsing, and the limits that stop a hostile file.

THE SECURITY TESTS ARE THE POINT OF THIS FILE. Everything here parses a file
someone uploaded, and every one of these vectors was verified to be live against
an earlier draft of the parser before the guard that stops it was added:

  * billion laughs — measured at TEN TIMES EXPANSION PER NESTING LEVEL, so a
    ~500-byte file with nine levels reaches a gigabyte in memory. Blocked by
    refusing any DOCTYPE, which also removes external entities in the same move.
  * zip bomb — a 299 KB KMZ declaring 300 MB of output. Blocked on the declared
    size before anything is decompressed.
  * zip path traversal — an entry named ../../etc/evil.kml.
  * coordinate flood — more points than fit in memory.

If a future change makes any of these pass, the parser has regressed into
something that can be knocked over by one upload. Admin auth sits in front of
the endpoint, which makes exploitation unlikely; it does not make the bug go
away, and "only admins can reach it" is not a reason to accept one.

Run with:  pytest backend/tests/test_kml_parser.py -v
"""
import io
import zipfile

import pytest

from app.kml.parser import (
    KmlParseError,
    MAX_TOTAL_COORDS,
    extract_kml_bytes,
    parse_coordinates,
    parse_kml,
    parse_upload,
)

KML_HEAD = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2">'


def kmz(kml_text: str, entry: str = "doc.kml") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(entry, kml_text)
    return buf.getvalue()


# ── Correctness ──────────────────────────────────────────────────────────────

def test_kml_is_lng_lat_and_we_store_lat_lng():
    """The single most consequential detail in the format.

    KML writes longitude FIRST. Everything else in this codebase is [lat, lng].
    Getting this backwards puts a Singapore cable in Somalia, and it looks
    plausible enough on a world map to survive review.
    """
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>103.85,1.29 114.2,22.3</coordinates></LineString></Placemark></kml>'
    parsed = parse_kml(doc.encode(), "x")
    assert parsed.paths[0].coords == [[1.29, 103.85], [22.3, 114.2]]


def test_a_file_may_hold_many_paths_and_they_keep_their_folder():
    """Whole-system exports are split; the folder is what later tells them apart."""
    doc = (
        f'{KML_HEAD}<Document><name>EAC System</name>'
        '<Folder><name>Trunk</name>'
        '<Placemark><name>SIN-HKG</name><LineString><coordinates>103.8,1.2 114.2,22.3</coordinates></LineString></Placemark>'
        '<Placemark><name>HKG-TYO</name><LineString><coordinates>114.2,22.3 139.7,35.6</coordinates></LineString></Placemark>'
        '</Folder></Document></kml>'
    )
    parsed = parse_kml(doc.encode(), "x")
    assert [p.name for p in parsed.paths] == ["SIN-HKG", "HKG-TYO"]
    assert {p.folder for p in parsed.paths} == {"Trunk"}
    assert parsed.document_name == "EAC System"


def test_points_are_kept_separately_from_paths():
    doc = (
        f'{KML_HEAD}<Folder><name>BMH</name>'
        '<Placemark><name>Changi BMH</name><Point><coordinates>103.98,1.39</coordinates></Point></Placemark></Folder>'
        '<Placemark><LineString><coordinates>103.8,1.2 114.2,22.3</coordinates></LineString></Placemark></kml>'
    )
    parsed = parse_kml(doc.encode(), "x")
    assert len(parsed.paths) == 1
    assert len(parsed.points) == 1
    assert parsed.points[0].name == "Changi BMH"
    assert parsed.points[0].folder == "BMH"


def test_altitude_is_kept_because_for_a_subsea_route_it_is_depth():
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>103.8,1.2,-25 110,10,-3200</coordinates></LineString></Placemark></kml>'
    parsed = parse_kml(doc.encode(), "x")
    assert parsed.paths[0].altitudes == [-25.0, -3200.0]


def test_whitespace_and_newlines_between_tuples():
    """Real exporters indent every point onto its own line."""
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>\n  103.8,1.2\n\t110.0,10.0\n  114.2,22.3\n</coordinates></LineString></Placemark></kml>'
    assert len(parse_kml(doc.encode(), "x").paths[0].coords) == 3


def test_consecutive_duplicate_points_are_dropped():
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>103.8,1.2 103.8,1.2 114.2,22.3</coordinates></LineString></Placemark></kml>'
    assert len(parse_kml(doc.encode(), "x").paths[0].coords) == 2


def test_out_of_range_coordinates_are_skipped_not_wrapped():
    """A latitude of 991 is corrupt. Wrapping it would draw a real-looking line
    somewhere wrong; dropping it leaves a short path the caller can question."""
    coords, _ = parse_coordinates("103.8,1.2 200.0,991.0 114.2,22.3", [1000])
    assert coords == [[1.2, 103.8], [22.3, 114.2]]


def test_a_single_point_linestring_is_not_a_path():
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>103.8,1.2</coordinates></LineString></Placemark></kml>'
    assert parse_kml(doc.encode(), "x").paths == []


def test_kmz_prefers_doc_kml_when_several_are_present():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("files/other.kml", f"{KML_HEAD}</kml>")
        z.writestr("doc.kml", f"{KML_HEAD}</kml>")
    _, entry = extract_kml_bytes(buf.getvalue(), "x.kmz")
    assert entry == "doc.kml"


def test_bare_kml_is_accepted_as_well_as_kmz():
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>103.8,1.2 114.2,22.3</coordinates></LineString></Placemark></kml>'
    assert len(parse_upload(doc.encode(), "route.kml").paths) == 1


def test_a_file_with_no_linestring_is_a_clear_error_not_an_empty_success():
    doc = f'{KML_HEAD}<Placemark><name>P</name><Point><coordinates>103.98,1.39</coordinates></Point></Placemark></kml>'
    with pytest.raises(KmlParseError) as exc:
        parse_upload(doc.encode(), "points_only.kml")
    assert "no LineString" in str(exc.value) or "no cable path" in str(exc.value).lower()


# ── Hostile input ────────────────────────────────────────────────────────────

def test_billion_laughs_is_refused():
    """Verified live against an earlier draft: 10x expansion per nesting level."""
    ents = '<!ENTITY e0 "' + "A" * 10 + '">' + "".join(
        f'<!ENTITY e{i} "' + "&e%d;" % (i - 1) * 10 + '">' for i in range(1, 9)
    )
    doc = f'<?xml version="1.0"?><!DOCTYPE k [{ents}]><kml><Document><name>&e8;</name></Document></kml>'
    with pytest.raises(KmlParseError):
        parse_kml(doc.encode(), "x")


def test_external_entity_cannot_read_a_local_file():
    doc = ('<?xml version="1.0"?><!DOCTYPE k [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>'
           '<kml><Document><name>&xxe;</name></Document></kml>')
    with pytest.raises(KmlParseError):
        parse_kml(doc.encode(), "x")


def test_any_doctype_at_all_is_refused():
    """The guard is the DOCTYPE itself, not a clever analysis of what's in it."""
    doc = f'<?xml version="1.0"?><!DOCTYPE kml><kml></kml>'
    with pytest.raises(KmlParseError) as exc:
        parse_kml(doc.encode(), "x")
    assert "DOCTYPE" in str(exc.value)


def test_zip_bomb_is_refused_on_declared_size():
    """299 KB compressed declaring 300 MB — refused before decompression."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", b"0" * (300 * 1024 * 1024))
    with pytest.raises(KmlParseError) as exc:
        parse_upload(buf.getvalue(), "bomb.kmz")
    assert "expands" in str(exc.value)


def test_zip_entry_escaping_its_directory_is_refused():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../../etc/evil.kml", f"{KML_HEAD}</kml>")
    with pytest.raises(KmlParseError) as exc:
        parse_upload(buf.getvalue(), "trav.kmz")
    assert "unsafe path" in str(exc.value)


def test_absolute_zip_entry_is_refused():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("/etc/evil.kml", f"{KML_HEAD}</kml>")
    with pytest.raises(KmlParseError):
        parse_upload(buf.getvalue(), "abs.kmz")


def test_coordinate_budget_is_shared_across_every_path_in_one_file():
    """Otherwise a file evades the cap by splitting one huge path into many."""
    budget = [10]
    parse_coordinates(" ".join("1,1" for _ in range(6)), budget)
    with pytest.raises(KmlParseError):
        parse_coordinates(" ".join(f"{i%90},{i%90}" for i in range(20)), budget)


def test_coordinate_flood_is_refused():
    huge = " ".join(f"{i % 179}.5,{i % 89}.5" for i in range(MAX_TOTAL_COORDS + 10))
    doc = f'{KML_HEAD}<Placemark><LineString><coordinates>{huge}</coordinates></LineString></Placemark></kml>'
    with pytest.raises(KmlParseError):
        parse_kml(doc.encode(), "x")


def test_garbage_bytes_give_a_readable_error():
    with pytest.raises(KmlParseError):
        parse_upload(b"\xff\xd8\xff\xe0 this is a JPEG", "x.kml")


def test_empty_file_is_rejected():
    with pytest.raises(KmlParseError):
        parse_upload(b"", "x.kmz")


def test_kmz_containing_no_kml_is_rejected():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("icon.png", b"\x89PNG")
    with pytest.raises(KmlParseError) as exc:
        parse_upload(buf.getvalue(), "x.kmz")
    assert "no .kml" in str(exc.value)
