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
  POST   /api/kml/bulk/propose             parse a batch, score, write nothing
  POST   /api/kml/bulk/commit              attach the approved matches
  POST   /api/kml/activate/{link_id}       roll back to a stored version
  DELETE /api/kml/link/{link_id}           remove one version
  GET    /api/kml/download/{link_id}       the original file, byte for byte
  GET    /api/kml/unused-files             blobs no version points at
  DELETE /api/kml/unused-files/{file_id}   remove one unreferenced blob

Writes are covered by admin_write_guard in main.py, which gates every
POST/PUT/DELETE — there is no separate auth here by design, so the rule stays in
one place.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from ..data_loader import load_nodes, load_segments
from ..kml import store
from ..kml.geometry import DISPLAY_POINT_BUDGET, build_geometry, simplify_path
from ..kml.matcher import (
    Candidate,
    PathProposal,
    rank_candidates,
    resolve_conflicts,
    segment_tokens_for,
    tokenise,
)
from ..kml.joiner import merge_fragments
from ..kml.parser import KmlParseError, parse_upload
from ..kml.splitter import split_path

log = logging.getLogger("routebuilder.kml")

router = APIRouter(prefix="/kml", tags=["kml"])


def _node_latlng(nodes, node_id):
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


# ── Bulk import ──────────────────────────────────────────────────────────────
#
# TWO STEPS, ALWAYS. `propose` parses and scores but writes no links; `commit`
# applies exactly what the reviewer approved. Nothing is attached to a segment
# without a person having seen which segment it was going to.
#
# The uploaded BYTES are stored during propose, even for paths that are never
# committed. That is deliberate: it is what lets commit carry only
# (file_id, path_index, segment_id) instead of re-uploading tens of MB, and the
# blob store is content-addressed so a file proposed twice costs one copy. The
# cost is that abandoning a review leaves unreferenced blobs, which the library
# view reports and Phase 3 will offer to sweep up.

#: Files per propose call. The frontend sends a few hundred files in batches of
#: this size so progress is visible and one failure does not lose the batch.
MAX_FILES_PER_BATCH = 25

#: Points in a proposal's preview path. Smaller than the stored display budget
#: because this is for judging a shape against the map, not for drawing the
#: final route — and because a batch ships one of these per row, so the cost is
#: paid per proposal rather than per segment.
PREVIEW_POINT_BUDGET = 100


def _merged_paths(parsed):
    """The reviewable paths in a file, after fragments are reassembled.

    THE PIPELINE IS parse → join → split → match, and this is the join. Some
    exporters write a cable as one LineString per survey run or chart sheet, so
    a single segment can arrive as fifty placemarks in no order with half of
    them drawn backwards. Matching those individually gives fifty rows all
    claiming the same segment and none of them scoring.

    Both propose and commit call this, so a path index always means the same
    thing. Deriving it rather than carrying merged geometry through the request
    is what keeps the two steps in agreement.
    """
    return merge_fragments(
        [p.coords for p in parsed.paths],
        names=[p.name for p in parsed.paths],
        folders=[p.folder for p in parsed.paths],
    )


def _proposal_dict(
    file_id, filename, path_index, path, path_count, *, coords, candidates,
    piece_index=None, piece_count=None, piece_nodes=None,
):
    """One reviewable row, whether it is a whole path or a slice of one.

    Carries a simplified `preview_path` so the review screen can draw the
    proposal on the real map. For a file that was cut into pieces this is the
    only way to judge the cuts: a table of node ids cannot show you that a join
    landed 200 km out to sea, or that a piece doubles back on itself.
    """
    proposal = PathProposal(
        file_id=file_id, filename=filename, path_index=path_index,
        path_name=path.name, folder=path.folder, point_count=len(coords),
        candidates=candidates,
    )
    return {
        "file_id": file_id,
        "filename": filename,
        "path_index": path_index,
        "path_name": path.name,
        "folder": path.folder,
        "point_count": len(coords),
        "paths_in_file": path_count,
        # Set only when this row is a slice of a longer trace. commit needs
        # both to cut the same way again; the UI needs them to say so.
        "piece_index": piece_index,
        "piece_count": piece_count,
        "piece_start_node": piece_nodes[0] if piece_nodes else None,
        "piece_end_node": piece_nodes[1] if piece_nodes else None,
        "preview_path": simplify_path(coords, PREVIEW_POINT_BUDGET),
        # How many of the file's LineStrings were reassembled into this path.
        # 1 means it arrived whole; 50 means the exporter had chopped it up and
        # the importer put it back together, which the reviewer should be told.
        "fragment_count": getattr(path, "fragment_count", 1),
        "ambiguous": proposal.ambiguous,
        "auto_acceptable": proposal.auto_acceptable,
        "candidates": [vars(c) for c in proposal.candidates],
    }


@router.post("/bulk/propose")
async def bulk_propose(files: list[UploadFile] = File(...)):
    """
    POST /api/kml/bulk/propose — parse a batch and say what each path might be.

    Writes NO links. Returns one proposal per cable path found (a whole-system
    file yields several), each with ranked candidates and the numbers behind
    them. Files that cannot be parsed are reported with their reason rather than
    failing the batch — one corrupt KMZ in a folder of three hundred should not
    cost the other 299.

    Auth: admin (admin_write_guard covers POST).
    """
    if len(files) > MAX_FILES_PER_BATCH:
        raise HTTPException(
            status_code=413,
            detail=f"{len(files)} files in one request; send at most {MAX_FILES_PER_BATCH} per batch.",
        )

    segments = [s.model_dump() for s in load_segments()]
    nodes = load_nodes()
    nodes_by_id = {n.id: n.model_dump() for n in nodes}
    seg_tokens = {s["id"]: segment_tokens_for(s, nodes_by_id) for s in segments}
    linked_ids = set(store.active_links())

    proposals: list[dict] = []
    rejected: list[dict] = []

    for upload in files:
        name = upload.filename or "upload.kml"
        data = await upload.read()
        try:
            parsed = parse_upload(data, name)
        except KmlParseError as exc:
            rejected.append({"filename": name, "reason": str(exc)})
            continue

        file_id = store.put_file(data, name)
        merged = _merged_paths(parsed)
        for index, path in enumerate(merged):
            # ONE LINESTRING MAY COVER SEVERAL SEGMENTS. A file is often a
            # single unbroken trace of a whole cable — Singapore to Mumbai to
            # Dubai to London — while the network models that as three
            # segments. split_path cuts it at the nodes it genuinely passes,
            # but only where every hop is a segment that already exists; when
            # it cannot do that honestly it returns None and the path is
            # matched whole, exactly as before.
            pieces = split_path(path.coords, list(nodes_by_id.values()), segments)

            if pieces:
                for piece_no, piece in enumerate(pieces):
                    # Each piece is scored from scratch rather than trusting the
                    # segment that justified the cut: where parallel cables run
                    # between the same two stations, any of them makes the hop
                    # valid and only the ranking can say which are plausible.
                    tokens = tokenise(name, path.name, path.folder, parsed.document_name)
                    proposals.append(_proposal_dict(
                        file_id, name, index, path, len(merged),
                        coords=piece.coords,
                        candidates=rank_candidates(
                            piece.coords, tokens, segments, nodes_by_id, seg_tokens, linked_ids,
                        ),
                        piece_index=piece_no, piece_count=len(pieces),
                        piece_nodes=(piece.start_node_id, piece.end_node_id),
                    ))
                continue

            tokens = tokenise(name, path.name, path.folder, parsed.document_name)
            proposals.append(_proposal_dict(
                file_id, name, index, path, len(merged),
                coords=path.coords,
                candidates=rank_candidates(
                    path.coords, tokens, segments, nodes_by_id, seg_tokens, linked_ids,
                ),
            ))

    # Rebuilt as PathProposal only to reuse the conflict logic on the same data.
    conflicts = resolve_conflicts([
        PathProposal(
            file_id=p["file_id"], filename=p["filename"], path_index=p["path_index"],
            path_name=p["path_name"], folder=p["folder"], point_count=p["point_count"],
            candidates=[Candidate(**c) for c in p["candidates"]],
        )
        for p in proposals
    ])

    return {
        "proposals": proposals,
        "rejected": rejected,
        "conflicts": conflicts,
        "summary": {
            "files_read": len(files) - len(rejected),
            "files_rejected": len(rejected),
            "paths_found": len(proposals),
            "auto_acceptable": sum(1 for p in proposals if p["auto_acceptable"]),
            "ambiguous": sum(1 for p in proposals if p["ambiguous"]),
            "no_candidate": sum(1 for p in proposals if not p["candidates"]),
        },
    }


@router.post("/bulk/commit")
def bulk_commit(payload: dict):
    """
    POST /api/kml/bulk/commit — attach the approved matches.

    Body: {"accepted": [{"file_id", "path_index", "segment_id"}, ...]}

    Each entry becomes a new version on its segment and is made active. The
    file is re-read from the blob store and re-parsed rather than any parsed
    state being held between the two calls — the request carries an index into a
    file, and the file is the source of truth for what that index means.

    One failure does not stop the rest: every entry is attempted and the result
    lists what worked and what did not, so a reviewer never has to guess which
    half of a batch landed.

    Auth: admin.
    """
    accepted = payload.get("accepted") or []
    if not isinstance(accepted, list):
        raise HTTPException(status_code=422, detail="'accepted' must be a list")

    segment_list = load_segments()
    segments = {s.id: s for s in segment_list}
    seg_dicts = [s.model_dump() for s in segment_list]
    nodes = load_nodes()
    linked: list[dict] = []
    failed: list[dict] = []
    parsed_cache: dict[str, object] = {}

    for entry in accepted:
        file_id = entry.get("file_id")
        segment_id = entry.get("segment_id")
        index = entry.get("path_index", 0)
        try:
            segment = segments.get(segment_id)
            if segment is None:
                raise ValueError(f"Unknown segment {segment_id!r}")

            if file_id not in parsed_cache:
                got = store.get_file_bytes(file_id)
                if got is None:
                    raise ValueError("Uploaded file is no longer in the store")
                parsed_cache[file_id] = parse_upload(got[0], got[1])
            parsed = parsed_cache[file_id]

            # SAME JOIN AS propose. The path index refers to a MERGED path, so
            # commit has to reassemble the fragments the same way before it can
            # look one up — re-derived from the file rather than carried through
            # the request, so the two steps cannot disagree about what index 3
            # means.
            merged = _merged_paths(parsed)
            if index >= len(merged):
                raise ValueError(
                    f"File now yields {len(merged)} paths; asked for index {index}. "
                    "Re-run the import."
                )
            path = merged[index]

            # A row may be one SLICE of a longer trace. The cut is recomputed
            # from the file rather than the coordinates being carried through
            # the request: the file is the source of truth for what a piece
            # index means, and re-deriving it means propose and commit cannot
            # disagree about where the joins are.
            coords = path.coords
            piece_index = entry.get("piece_index")
            if piece_index is not None:
                pieces = split_path(coords, [n.model_dump() for n in nodes], seg_dicts)
                if not pieces:
                    raise ValueError(
                        "This path no longer splits into segments — the network may have "
                        "changed since it was proposed. Re-run the import."
                    )
                if piece_index >= len(pieces):
                    raise ValueError(f"Path splits into {len(pieces)} pieces; asked for {piece_index}")
                coords = pieces[piece_index].coords

            geometry = build_geometry(
                coords,
                _node_latlng(nodes, segment.start_node_id),
                _node_latlng(nodes, segment.end_node_id),
            )
            points = [
                {"name": p.name, "lat": p.lat, "lng": p.lng, "folder": p.folder}
                for p in parsed.points
            ]
            row = store.link_segment(
                segment_id, file_id, geometry,
                placemark_name=path.name or "", points=points,
            )
            linked.append({
                "segment_id": segment_id,
                "piece_index": piece_index,
                "link_id": row["id"],
                "version": row["version"],
                "length_km": row["length_km"],
                "stored_length_km": segment.length_km,
                "point_count": row["point_count"],
                "needs_review": geometry.needs_review,
            })
        except (ValueError, KmlParseError) as exc:
            failed.append({"file_id": file_id, "segment_id": segment_id,
                           "path_index": index, "reason": str(exc)})

    log.info("KML bulk commit: %d linked, %d failed", len(linked), len(failed))
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
