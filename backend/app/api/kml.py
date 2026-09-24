"""
kml.py — upload, serve and manage cable-route geometry from KMZ/KML files.

Route prefix: /api/kml (mounted under /api by main.py).

WHY GEOMETRY IS NOT PART OF /api/segments. The frontend loads every segment in
one call at boot. That payload is 180 KB today because waypoints are hand-placed
hints — a median of two per segment, 267 across the whole network. A real KML
carries thousands of points for ONE segment, so shipping full resolution for all
322 would be ~39 MB per page load to draw detail smaller than a pixel. Instead:

  GET /api/kml/paths            every segment's SIMPLIFIED path, ~1 MB for the
                                whole network, fetched once alongside the
                                reference data and used to draw the overview.
  GET /api/kml/paths/{seg_id}   ONE segment's full-resolution path, fetched when
                                you open or zoom that segment.

Keeping them off the segment model also means the KML feature can fail entirely
— a bad deploy, a missing table — and the map still draws, because segments
never depended on it.

Endpoints:
  GET    /api/kml/paths                    simplified paths for every segment
  GET    /api/kml/paths/{segment_id}       full-resolution path for one segment
  GET    /api/kml/library                  linkage overview: linked, gaps, orphans
  GET    /api/kml/versions/{segment_id}    version history for one segment
  POST   /api/kml/upload                   upload one file against one segment
  GET    /api/kml/scm/cables               search submarinecablemap.com's cable list
  POST   /api/kml/flatten                  parse/fetch a batch, re-chop it into
                                            chains (see kml/flatten.py), write nothing
  POST   /api/kml/commit-chop              attach the human-chopped stretches
  POST   /api/kml/activate/{link_id}       roll back to a stored version
  DELETE /api/kml/link/{link_id}           remove one version
  DELETE /api/kml/segments                 remove EVERY version for each of several segments
  GET    /api/kml/download/{link_id}       the original file, byte for byte
  GET    /api/kml/unused-files             blobs no version points at
  DELETE /api/kml/unused-files/{file_id}   remove one unreferenced blob
  DELETE /api/kml/unused-files             remove EVERY unreferenced blob at once

MULTI-SEGMENT IMPORTS. `POST /api/kml/upload` is the one-to-one path — one
file, one segment, and if the file holds several paths the caller must name
one (409 otherwise). `/flatten` + `/commit-chop` are the other path, for a
file (or a submarinecablemap.com sync) that may cover SEVERAL segments,
including branching cables where an automatic node-anchor split can fail —
see kml/flatten.py's module docstring for why an earlier automatic-scoring
design (join by placemark, split only where an existing segment graph proves
a cut point) was replaced: it could not represent AJC, a real three-segment
cable branching at Guam, because the auto-joined trunk never came within
30km of the Guam node. The replacement flattens an import's own fragments
into chains by geometric proximity, suggests cuts wherever the DECLARED
segments' nodes anchor onto a chain, and leaves the rest for a human to
place — a suggestion, never a gate.

Writes are covered by admin_write_guard in main.py, which gates every
POST/PUT/DELETE — there is no separate auth here by design, so the rule stays in
one place.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from ..data_loader import load_nodes, load_segments
from ..kml import store, submarinecablemap
from ..kml.flatten import flatten_to_chains, join_stretches_for_segment, suggest_cuts
from ..kml.geometry import DISPLAY_POINT_BUDGET, build_geometry
from ..kml.joiner import merge_fragments
from ..kml.parser import KmlParseError, parse_kml, parse_upload

log = logging.getLogger("routebuilder.kml")

router = APIRouter(prefix="/kml", tags=["kml"])


def _scm_enabled() -> bool:
    """submarinecablemap.com integration. False only when SCM_ENABLED is
    exactly "false" — matches app/main.py's own _scm_enabled(), duplicated
    here (rather than imported) so this router has no dependency on main.py,
    the same "each module reads its own flag" convention NLP_ENABLED already
    uses across main.py and api/health.py.

    Unlike outage_parser/hazards/cableimport, this router is NOT skippable
    wholesale — most of app/api/kml.py (upload, chop, library) has nothing to
    do with submarinecablemap.com, so only the two endpoints/branches that
    actually call it check this flag."""
    return os.getenv("SCM_ENABLED", "").strip().lower() != "false"


def _node_latlng(nodes, node_id):
    """(lat, lng) for the node with this id in `nodes`, or None if it is not
    found (unknown/blank start_node_id/end_node_id on a segment)."""
    n = next((x for x in nodes if x.id == node_id), None)
    return (n.lat, n.lng) if n else None


@router.get("/paths")
def get_paths():
    """
    GET /api/kml/paths — every segment's active SIMPLIFIED path.

    The map's overview source. Returns a dict keyed by segment_id so the client
    can look up a segment in O(1) while drawing, rather than scanning a list per
    segment. Deliberately excludes full_path — see the module docstring.

    Auth: public read.
    """
    links = store.active_links()
    return {
        "paths": {
            seg_id: {
                "link_id": row["id"],
                "version": row["version"],
                "display_path": row["display_path"],
                "length_km": row["length_km"],
                "point_count": row["point_count"],
                "a_end_gap_km": row["a_end_gap_km"],
                "z_end_gap_km": row["z_end_gap_km"],
                "reversed": row["reversed"],
                "point_markers": len(row.get("points") or []),
                "source": row.get("source", "upload"),
            }
            for seg_id, row in links.items()
        },
        "count": len(links),
        "display_point_budget": DISPLAY_POINT_BUDGET,
    }


@router.get("/paths/{segment_id}")
def get_full_path(segment_id: str):
    """
    GET /api/kml/paths/{segment_id} — the full-resolution path for one segment.

    Fetched on demand when a segment is opened or zoomed. This is the only
    endpoint that returns every surveyed point, and it returns them for exactly
    one segment, which is what keeps the design's promise.

    Auth: public read.
    """
    row = store.full_path_for(segment_id)
    if not row:
        raise HTTPException(status_code=404, detail=f"No KML geometry for segment {segment_id!r}")
    return {
        "segment_id": segment_id,
        "link_id": row["id"],
        "version": row["version"],
        "full_path": row["full_path"],
        "points": row.get("points") or [],
        "length_km": row["length_km"],
        "point_count": row["point_count"],
        "a_end_gap_km": row["a_end_gap_km"],
        "z_end_gap_km": row["z_end_gap_km"],
        "reversed": row["reversed"],
        "source": row.get("source", "upload"),
    }


@router.get("/library")
def get_library():
    """
    GET /api/kml/library — what is linked, what is missing.

    States coverage plainly rather than only listing what exists: a library
    screen that shows 218 linked files and says nothing about the 104 segments
    without one invites the reading that the network is covered.

    Auth: public read.
    """
    segments = load_segments()
    links = store.active_links()
    linked_ids = set(links)

    linked, gaps = [], []
    for seg in segments:
        row = links.get(seg.id)
        if row:
            linked.append({
                "segment_id": seg.id, "name": seg.name, "system_id": seg.system_id,
                "type": seg.type.value if hasattr(seg.type, "value") else seg.type,
                "link_id": row["id"], "version": row["version"],
                "kml_length_km": row["length_km"], "stored_length_km": seg.length_km,
                "point_count": row["point_count"],
                "a_end_gap_km": row["a_end_gap_km"], "z_end_gap_km": row["z_end_gap_km"],
                "created_at": row["created_at"],
                "source": row.get("source", "upload"),
            })
        else:
            gaps.append({
                "segment_id": seg.id, "name": seg.name, "system_id": seg.system_id,
                "type": seg.type.value if hasattr(seg.type, "value") else seg.type,
                "waypoint_count": len(seg.waypoints or []),
            })

    # A link whose segment no longer exists — the segment was renamed or deleted
    # after the KML was attached. Surfaced rather than silently ignored.
    segment_ids = {s.id for s in segments}
    orphans = [
        {"segment_id": sid, "link_id": row["id"], "version": row["version"]}
        for sid, row in links.items() if sid not in segment_ids
    ]

    return {
        "linked": linked,
        "gaps": gaps,
        "orphans": orphans,
        "summary": {
            "segments_total": len(segments),
            "linked": len(linked_ids & segment_ids),
            "gaps": len(gaps),
            "orphans": len(orphans),
        },
    }


@router.get("/versions/{segment_id}")
def get_versions(segment_id: str):
    """GET /api/kml/versions/{segment_id} — full upload history, newest first."""
    return {"segment_id": segment_id, "versions": store.versions_for(segment_id)}


def _merged_paths(parsed):
    """The reviewable paths in a file, after fragments are reassembled by
    exact-endpoint proximity (joiner.merge_fragments) — the one-to-one upload
    path's own join step. Kept distinct from flatten.py's flatten_to_chains:
    this trusts the file's own placemark/path split for WHICH path an upload
    is meant to attach to a single named segment (see the 409 branch below);
    flatten_to_chains exists precisely because that trust breaks down once a
    file might cover several segments — see flatten.py's module docstring.
    """
    return merge_fragments(
        [p.coords for p in parsed.paths],
        names=[p.name for p in parsed.paths],
        folders=[p.folder for p in parsed.paths],
    )


@router.post("/upload")
async def upload_kml(
    file: UploadFile = File(...),
    segment_id: str = Form(...),
    placemark: str = Form(None),
):
    """
    POST /api/kml/upload — attach one KMZ/KML to one segment.

    The one-to-one path. A file holding several paths is not guessed at here:
    if `placemark` does not name one, the candidates are returned with a 409 so
    the caller can choose. Guessing would attach a neighbouring cable's route to
    this segment and look entirely plausible on the map.

    Always creates a NEW VERSION and makes it active; nothing is overwritten.

    Auth: admin (admin_write_guard covers POST).
    """
    segments = load_segments()
    segment = next((s for s in segments if s.id == segment_id), None)
    if segment is None:
        raise HTTPException(status_code=404, detail=f"Unknown segment {segment_id!r}")

    data = await file.read()
    try:
        parsed = parse_upload(data, file.filename or "upload.kml")
    except KmlParseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    # Fragments are reassembled here too, for the same reason as in bulk: a file
    # an exporter chopped into fifty runs is ONE cable, and offering fifty
    # candidates would be describing the export rather than the network. After
    # merging, a file that still holds several paths genuinely holds several.
    merged = _merged_paths(parsed)

    if len(merged) > 1 and not placemark:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    f"This file contains {len(merged)} separate paths. Choose which one belongs "
                    f"to {segment_id}, or use bulk upload to match them all at once."
                ),
                "candidates": [
                    {"index": i, "name": p.name, "folder": p.folder,
                     "points": len(p.coords), "fragments": p.fragment_count}
                    for i, p in enumerate(merged)
                ],
            },
        )

    if placemark:
        chosen = next((p for p in merged if p.name == placemark), None)
        if chosen is None:
            raise HTTPException(status_code=404, detail=f"No path named {placemark!r} in this file")
    else:
        chosen = merged[0]

    nodes = load_nodes()
    geometry = build_geometry(
        chosen.coords,
        _node_latlng(nodes, segment.start_node_id),
        _node_latlng(nodes, segment.end_node_id),
    )

    file_id = store.put_file(data, file.filename or "upload.kml")
    points = [
        {"name": p.name, "lat": p.lat, "lng": p.lng, "folder": p.folder}
        for p in parsed.points
    ]
    row = store.link_segment(
        segment_id, file_id, geometry,
        placemark_name=chosen.name or "", points=points,
    )
    log.info("KML attached to %s v%s (%d points, %.1f km)",
             segment_id, row["version"], row["point_count"], row["length_km"] or 0)

    return {
        "segment_id": segment_id,
        "link_id": row["id"],
        "version": row["version"],
        "placemark_name": row["placemark_name"],
        "length_km": row["length_km"],
        "stored_length_km": segment.length_km,
        "point_count": row["point_count"],
        "display_point_count": len(row["display_path"]),
        "a_end_gap_km": row["a_end_gap_km"],
        "z_end_gap_km": row["z_end_gap_km"],
        "reversed": row["reversed"],
        "needs_review": geometry.needs_review,
        "points_stored": len(points),
        "paths_in_file": len(merged),
        "fragments_merged": chosen.fragment_count,
    }


@router.post("/activate/{link_id}")
def activate_version(link_id: str):
    """POST /api/kml/activate/{link_id} — make a stored version the active one."""
    segment_id = store.activate(link_id)
    if segment_id is None:
        raise HTTPException(status_code=404, detail="No such KML version")
    return {"segment_id": segment_id, "link_id": link_id, "active": True}


@router.delete("/link/{link_id}")
def delete_version(link_id: str):
    """DELETE /api/kml/link/{link_id} — remove one version.

    If it was the active one the newest remaining takes over, so a segment is
    never left holding versions with none of them drawn."""
    segment_id = store.delete_link(link_id)
    if segment_id is None:
        raise HTTPException(status_code=404, detail="No such KML version")
    return {"segment_id": segment_id, "deleted": link_id}


@router.delete("/segments")
def delete_segments_kml(payload: dict):
    """
    DELETE /api/kml/segments — remove EVERY version for each given segment in
    one call: "delete this KML entirely" for a batch of segments, as opposed
    to delete_link()'s one-version-at-a-time undo. The segments themselves
    are untouched — only their geometry — so each one reverts to drawing
    from its waypoints (or a straight line) and reappears in the Library's
    Gaps tab, exactly as if it had never been surveyed.

    Body: {"segment_ids": [...]}. An id with no KML on file is simply a
    no-op (0 removed), not an error — the caller does not have to check the
    Library first to know which of its selection actually have anything.

    Auth: admin.
    """
    segment_ids = payload.get("segment_ids") or []
    if not isinstance(segment_ids, list) or not segment_ids:
        raise HTTPException(status_code=422, detail="'segment_ids' must be a non-empty list")

    removed: dict[str, int] = {}
    for segment_id in segment_ids:
        removed[segment_id] = store.delete_all_for_segment(segment_id)

    versions_deleted = sum(removed.values())
    segments_cleared = sum(1 for n in removed.values() if n > 0)
    log.info("KML bulk segment delete: %d segments, %d versions", segments_cleared, versions_deleted)
    return {"removed": removed, "segments_cleared": segments_cleared, "versions_deleted": versions_deleted}


@router.get("/download/{link_id}")
def download_original(link_id: str):
    """
    GET /api/kml/download/{link_id} — the uploaded file, byte for byte.

    Serves the stored original rather than re-serialising the parsed geometry:
    what went in is what comes out, including anything this app does not itself
    understand.

    Auth: public read (the geometry is already served above).
    """
    file_id = _file_id_for_link(link_id)
    if file_id is None:
        raise HTTPException(status_code=404, detail="No such KML version")
    got = store.get_file_bytes(file_id)
    if got is None:
        raise HTTPException(status_code=404, detail="Stored file is missing")
    blob, filename = got
    media = "application/vnd.google-earth.kmz" if filename.lower().endswith(".kmz") \
        else "application/vnd.google-earth.kml+xml"
    return Response(
        content=blob,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _file_id_for_link(link_id: str):
    """The file behind one version. Small helper so download stays readable."""
    if store._use_db():  # noqa: SLF001 - same package, one storage concern
        from ..db import get_conn
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT file_id FROM segment_kml WHERE id = %s", (link_id,))
            row = cur.fetchone()
            return row["file_id"] if row else None
    for link in store._read_index()["links"]:  # noqa: SLF001
        if link["id"] == link_id:
            return link["file_id"]
    return None


#: Files per import call. The frontend sends a few hundred files in batches of
#: this size so progress is visible and one failure does not lose the batch.
MAX_FILES_PER_BATCH = 25


@router.get("/scm/cables")
def scm_cables(q: str = ""):
    """
    GET /api/kml/scm/cables?q= — search submarinecablemap.com's cable list.

    A thin proxy so the frontend never calls a third-party host directly, the
    same reasoning as the bushfire.io proxy in api/hazards.py — though here
    there is no secret to protect, only a consistent cache and error shape. An
    empty `q` returns the first page alphabetically, enough for a picker to
    show something before anyone has typed.

    Auth: public read.
    """
    if not _scm_enabled():
        raise HTTPException(status_code=503, detail="submarinecablemap.com integration is disabled (SCM_ENABLED=false)")
    try:
        cables = submarinecablemap.search_cables(q) if q else submarinecablemap.list_cables()
    except submarinecablemap.ScmError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"cables": cables}


def _load_parsed_from_files(file_ids: list[str]) -> tuple[list, list]:
    """Re-parse every stored file, in the given order, and pool their paths
    and points. The one place both /flatten and /commit-chop go to get "the
    points this import action actually contains" — re-derived from the blob
    store every time, never carried through a request, so the two calls can
    never disagree about what a chain_index/point-range means. Raises
    ValueError (not HTTPException) so callers can choose their own status
    code for "the file this refers to is gone"."""
    all_paths = []
    all_points = []
    for file_id in file_ids:
        got = store.get_file_bytes(file_id)
        if got is None:
            raise ValueError(f"Stored file {file_id!r} is no longer available — re-run the import.")
        data, filename = got
        parsed = parse_upload(data, filename)
        all_paths.extend(parsed.paths)
        all_points.extend(parsed.points)
    return all_paths, all_points


@router.post("/flatten")
async def flatten_import(
    files: list[UploadFile] = File(default=[]),
    cable_id: str = Form(None),
    system_id: str = Form(default=""),
    segment_ids: list[str] = Form(default=[]),
):
    """
    POST /api/kml/flatten — parse or fetch one import and reassemble it into
    OUR OWN chains (see flatten.py's module docstring for why the file's own
    placemark/fragment boundaries are not trusted).

    Exactly one of `files` (a KMZ/KML batch — one IMPORT ACTION, however many
    files it is split across) or `cable_id` (a submarinecablemap.com sync)
    must be given. `system_id`/`segment_ids` are BOTH OPTIONAL: a reviewer
    usually cannot say which segments an import covers until they have seen
    its shape on the map, so this endpoint never requires that answer up
    front — it flattens on geometry alone and returns empty `suggested_cuts`
    when nothing was declared yet. Once the reviewer picks (or changes) the
    system, call POST /api/kml/suggest-cuts separately rather than re-calling
    this one — it re-derives the identical chains from `file_ids` without
    re-fetching or re-uploading anything.

    Writes NO segment_kml links, but DOES store the file bytes (content-
    addressed, so re-flattening the same import costs nothing extra) — that
    is what lets POST /api/kml/commit-chop (and /suggest-cuts) re-derive the
    identical chains later from `file_ids` alone, the same "never trust
    client-carried geometry" principle the old bulk/commit endpoint already
    followed.

    Auth: admin (admin_write_guard covers POST).
    """
    if bool(files) == bool(cable_id):
        raise HTTPException(status_code=422, detail="Provide exactly one of `files` or `cable_id`.")

    file_ids: list[str] = []
    rejected: list[dict] = []
    cable_name = None
    parsed_batches = []

    if cable_id:
        if not _scm_enabled():
            raise HTTPException(status_code=503, detail="submarinecablemap.com integration is disabled (SCM_ENABLED=false) — upload files instead")
        try:
            kml_bytes, filename, cable_name = submarinecablemap.fetch_cable_kml(cable_id)
        except submarinecablemap.ScmError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        try:
            parsed_batches.append(parse_kml(kml_bytes, source_name=filename))
        except KmlParseError as exc:  # pragma: no cover — our own builder's output
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        file_ids.append(store.put_file(kml_bytes, filename, uploaded_by="submarinecablemap-sync"))
        source = "submarinecablemap"
    else:
        if len(files) > MAX_FILES_PER_BATCH:
            raise HTTPException(
                status_code=413,
                detail=f"{len(files)} files in one request; send at most {MAX_FILES_PER_BATCH} per batch.",
            )
        for upload in files:
            name = upload.filename or "upload.kml"
            data = await upload.read()
            try:
                parsed_batches.append(parse_upload(data, name))
            except KmlParseError as exc:
                rejected.append({"filename": name, "reason": str(exc)})
                continue
            file_ids.append(store.put_file(data, name))
        if not file_ids:
            raise HTTPException(status_code=422, detail="No file in the batch could be parsed.")
        source = "upload"

    paths = [p for parsed in parsed_batches for p in parsed.paths]
    chains = flatten_to_chains(paths)

    all_segments = {s.id: s.model_dump() for s in load_segments()}
    declared = [all_segments[sid] for sid in segment_ids if sid in all_segments]
    nodes_by_id = {n.id: n.model_dump() for n in load_nodes()}

    return {
        "file_ids": file_ids,
        "source": source,
        "cable_name": cable_name,
        "rejected": rejected,
        "chains": [
            {
                "index": i,
                "coords": c.coords,
                "point_count": c.point_count,
                "fragment_count": c.fragment_count,
                "kink_indices": c.kink_indices,
                "suggested_cuts": [vars(cut) for cut in suggest_cuts(c, declared, nodes_by_id)],
            }
            for i, c in enumerate(chains)
        ],
    }


@router.post("/suggest-cuts")
def suggest_cuts_for_import(payload: dict):
    """
    POST /api/kml/suggest-cuts — re-suggest cuts once the reviewer has picked
    (or changed) which system/segments an already-flattened import covers,
    without re-fetching or re-uploading anything.

    Body: {"file_ids": [...], "system_id": str, "segment_ids": [...]}

    Re-derives the SAME chains POST /api/kml/flatten returned — deterministic
    from `file_ids` alone — and returns just their `suggested_cuts`; the
    reviewer already has every chain's coordinates from the original flatten
    response, so there is no reason to resend them. Declaring a DIFFERENT
    system later (the reviewer looked at the shape and changed their mind)
    is exactly what this endpoint is for: call it again with the new
    system_id/segment_ids and re-merge the result.

    Auth: admin (admin_write_guard covers POST).
    """
    file_ids = payload.get("file_ids") or []
    system_id = payload.get("system_id") or ""
    segment_ids = payload.get("segment_ids") or []
    if not file_ids:
        raise HTTPException(status_code=422, detail="'file_ids' must be a non-empty list")
    if not system_id or not segment_ids:
        return {"chains": []}

    try:
        paths, _points = _load_parsed_from_files(file_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    chains = flatten_to_chains(paths)

    all_segments = {s.id: s.model_dump() for s in load_segments()}
    declared = [all_segments[sid] for sid in segment_ids if sid in all_segments]
    nodes_by_id = {n.id: n.model_dump() for n in load_nodes()}

    return {
        "chains": [
            {"index": i, "suggested_cuts": [vars(cut) for cut in suggest_cuts(c, declared, nodes_by_id)]}
            for i, c in enumerate(chains)
        ],
    }


@router.post("/commit-chop")
def commit_chop(payload: dict):
    """
    POST /api/kml/commit-chop — attach the human-chopped stretches.

    Body: {"file_ids": [...], "source": "upload"|"submarinecablemap",
           "cuts": [{"chain_index", "start_idx", "end_idx", "segment_id"}, ...]}

    Re-derives the SAME chains POST /api/kml/flatten returned by re-parsing
    the stored files (in the given order) and re-running flatten_to_chains —
    a pure function of the bytes alone, so this never has to trust a
    chain's coordinates carried through the request, only which INDICES the
    reviewer chose. One cut fails independently of the rest, matching the old
    bulk/commit endpoint's own pattern.

    A cut's geometry may span points that originated in more than one of
    `file_ids` (that is the whole point of flattening several files as one
    import action) — the link is still recorded against `file_ids[0]` for
    "download original", since segment_kml.file_id is a single reference;
    downloading gets you A source file for that route, not necessarily every
    byte that contributed to it, in the rare case a stretch really does cross
    a file boundary.

    Two cuts may legitimately share the same (chain_index, start_idx,
    end_idx) with different segment_ids — a real but unmodelled branch
    point, where two whole segments are each defined end-to-end through the
    same physical trunk rather than meeting at a shared branching-unit node.
    Each is just its own independent entry here and gets the identical
    coordinate range attached separately; nothing about this endpoint treats
    a point range as owned by only one segment.

    The MIRROR case also happens: the SAME segment_id on two or more cuts,
    from different stretches or different chains entirely — a genuine gap in
    the survey data, or a branch that likewise has no shared branching-unit
    node on this side. Calling store.link_segment() once per cut here would
    be wrong: each call creates a new version and only the last one stays
    active, so the earlier stretch would silently vanish rather than the two
    becoming one segment's real route. So cuts are grouped by segment_id
    FIRST; a segment with only one stretch behaves exactly as before, and one
    with several gets them ordered and oriented into a single path by
    join_stretches_for_segment() (nearest-endpoint proximity, walking out
    from whichever stretch sits closest to the segment's A node) before the
    one store.link_segment() call that segment gets. Each returned `linked`
    row therefore corresponds to a SEGMENT, not a cut — see `chain_indices`
    and `stretches_joined`.

    Auth: admin.
    """
    file_ids = payload.get("file_ids") or []
    source = payload.get("source") or "upload"
    cuts = payload.get("cuts") or []
    if not isinstance(file_ids, list) or not file_ids:
        raise HTTPException(status_code=422, detail="'file_ids' must be a non-empty list")
    if source not in ("upload", "submarinecablemap"):
        raise HTTPException(status_code=422, detail=f"Unknown source {source!r}")
    if not isinstance(cuts, list):
        raise HTTPException(status_code=422, detail="'cuts' must be a list")

    try:
        paths, points = _load_parsed_from_files(file_ids)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    chains = flatten_to_chains(paths)
    point_dicts = [{"name": p.name, "lat": p.lat, "lng": p.lng, "folder": p.folder} for p in points]

    segments = {s.id: s for s in load_segments()}
    nodes = load_nodes()

    # Resolve and validate every cut first, grouping its coordinates under
    # its segment_id — a bad chain/range/segment fails independently, same
    # as before, without touching the group its segment_id belongs to.
    by_segment: dict[str, list[tuple[int, list[list[float]]]]] = {}
    failed: list[dict] = []
    for cut in cuts:
        chain_index = cut.get("chain_index")
        start_idx = cut.get("start_idx")
        end_idx = cut.get("end_idx")
        segment_id = cut.get("segment_id")
        try:
            if not isinstance(chain_index, int) or not (0 <= chain_index < len(chains)):
                raise ValueError(f"Chain {chain_index!r} no longer exists — re-run flatten.")
            chain = chains[chain_index]
            if not isinstance(start_idx, int) or not isinstance(end_idx, int) \
                    or not (0 <= start_idx < end_idx < chain.point_count):
                raise ValueError(f"Invalid point range {start_idx}-{end_idx} for chain {chain_index}")
            if segment_id not in segments:
                raise ValueError(f"Unknown segment {segment_id!r}")
            by_segment.setdefault(segment_id, []).append((chain_index, chain.coords[start_idx:end_idx + 1]))
        except ValueError as exc:
            failed.append({"chain_index": chain_index, "segment_id": segment_id, "reason": str(exc)})

    linked: list[dict] = []
    for segment_id, entries in by_segment.items():
        segment = segments[segment_id]
        chain_indices = [ci for ci, _coords in entries]
        try:
            stretches = [coords for _ci, coords in entries]
            coords = (
                stretches[0] if len(stretches) == 1
                else join_stretches_for_segment(stretches, _node_latlng(nodes, segment.start_node_id))
            )
            geometry = build_geometry(
                coords,
                _node_latlng(nodes, segment.start_node_id),
                _node_latlng(nodes, segment.end_node_id),
            )
            row = store.link_segment(
                segment_id, file_ids[0], geometry,
                placemark_name="", points=point_dicts, source=source,
            )
            linked.append({
                "segment_id": segment_id,
                "chain_indices": chain_indices,
                "stretches_joined": len(stretches),
                "link_id": row["id"],
                "version": row["version"],
                "length_km": row["length_km"],
                "stored_length_km": segment.length_km,
                "point_count": row["point_count"],
                "needs_review": geometry.needs_review,
                "source": source,
            })
        except ValueError as exc:
            failed.append({"chain_index": chain_indices[0] if chain_indices else None,
                            "segment_id": segment_id, "reason": str(exc)})

    log.info("KML commit-chop: %d linked, %d failed", len(linked), len(failed))
    return {"linked": linked, "failed": failed,
            "summary": {"linked": len(linked), "failed": len(failed)}}


@router.get("/unused-files")
def list_unused_files():
    """
    GET /api/kml/unused-files — uploaded blobs no version points at.

    These accumulate honestly: propose stores every file it parses so commit can
    carry an index rather than re-uploading, so an abandoned review — or one
    where three of fifty paths were approved — leaves the rest behind. Listed
    rather than swept, because deleting what nobody asked about is how you lose
    the one file someone meant to come back to.

    Auth: public read (it is a list of names and sizes, not content).
    """
    files = store.unreferenced_files()
    return {
        "files": files,
        "count": len(files),
        "total_bytes": sum(f.get("size_bytes") or 0 for f in files),
    }


@router.delete("/unused-files/{file_id}")
def delete_unused_file(file_id: str):
    """
    DELETE /api/kml/unused-files/{file_id} — remove one unreferenced blob.

    Refuses if a version still points at it. That check lives in the store, not
    here, so it cannot be bypassed by a second caller: deleting a referenced
    blob would leave a version undownloadable while still claiming to be the
    segment's surveyed route.

    Auth: admin.
    """
    if not store.delete_file(file_id):
        raise HTTPException(
            status_code=409,
            detail="That file is still attached to a segment version, or no longer exists.",
        )
    return {"deleted": file_id}


@router.delete("/unused-files")
def delete_all_unused_files():
    """
    DELETE /api/kml/unused-files — clear EVERY currently-unreferenced blob in
    one call, not one at a time.

    These pile up faster since the Chop Import tool (/flatten) stores a
    file's bytes on every plot whether or not the reviewer ever commits it —
    trying three imports to see which one looks right on the map leaves two
    behind, same as the old propose/commit review did. Re-derives the list
    itself rather than trusting one the caller might be holding stale, and
    calls the SAME per-file store.delete_file() the single-file endpoint
    uses, so a file a commit-chop call links in the middle of this request
    is skipped rather than deleted out from under it.

    Auth: admin.
    """
    deleted = [f["id"] for f in store.unreferenced_files() if store.delete_file(f["id"])]
    log.info("KML unused-files bulk delete: %d removed", len(deleted))
    return {"deleted": deleted, "count": len(deleted)}
