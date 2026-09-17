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
  POST   /api/kml/activate/{link_id}       roll back to a stored version
  DELETE /api/kml/link/{link_id}           remove one version
  GET    /api/kml/download/{link_id}       the original file, byte for byte

Writes are covered by admin_write_guard in main.py, which gates every
POST/PUT/DELETE — there is no separate auth here by design, so the rule stays in
one place.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile

from ..data_loader import load_nodes, load_segments
from ..kml import store
from ..kml.geometry import DISPLAY_POINT_BUDGET, build_geometry
from ..kml.parser import KmlParseError, parse_upload

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

    if len(parsed.paths) > 1 and not placemark:
        raise HTTPException(
            status_code=409,
            detail={
                "message": (
                    f"This file contains {len(parsed.paths)} paths. Choose which one belongs "
                    f"to {segment_id}, or use bulk upload to match them all at once."
                ),
                "candidates": [
                    {"index": i, "name": p.name, "folder": p.folder, "points": len(p.coords)}
                    for i, p in enumerate(parsed.paths)
                ],
            },
        )

    if placemark:
        chosen = next((p for p in parsed.paths if p.name == placemark), None)
        if chosen is None:
            raise HTTPException(status_code=404, detail=f"No path named {placemark!r} in this file")
    else:
        chosen = parsed.paths[0]

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
        "paths_in_file": len(parsed.paths),
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
