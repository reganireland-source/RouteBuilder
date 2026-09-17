"""
Persistence for uploaded cable-route geometry, in both storage modes.

Mirrors app/data_loader.py: Postgres when DATABASE_URL is set, JSON + files on
disk when it is not, chosen per call so local dev needs no database. The two
must stay interchangeable — that is a standing property of this codebase, not a
convenience — so every function here has both paths.

WHAT IS STORED WHERE
    kml_files    the uploaded bytes, once, keyed by sha256. Two segments sharing
                 a whole-system KMZ store one blob, and re-uploading a file
                 already held returns the existing row instead of a duplicate.
    segment_kml  one row per (segment, version): the simplified display path,
                 the full path, parsed points, the measured length and the
                 endpoint gaps. Exactly one row per segment is `active`.

THE ONE-ACTIVE RULE IS THE DATABASE'S JOB. A partial unique index on
(segment_id) WHERE active means a bug in activate() raises instead of leaving
two versions drawn on top of each other. File mode cannot express that, so
_file_activate() does the deactivate and the activate in one rewrite of the
index rather than two, which is the same guarantee by a weaker mechanism.

NOT ENCRYPTED at the application layer — see the schema comment in db.py for
exactly what Railway's at-rest encryption does and does not cover.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..data_loader import DATA_DIR, _use_db
from ..db import get_conn

#: Blobs in file mode live beside the JSON, one file per sha256.
KML_BLOB_DIR = DATA_DIR / "kml"
#: The file-mode stand-in for the two tables.
KML_INDEX_PATH = DATA_DIR / "kml_index.json"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ── File-mode index helpers ──────────────────────────────────────────────────

def _read_index() -> dict[str, list[dict]]:
    if not KML_INDEX_PATH.exists():
        return {"files": [], "links": []}
    try:
        with open(KML_INDEX_PATH) as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError):
        return {"files": [], "links": []}
    data.setdefault("files", [])
    data.setdefault("links", [])
    return data


def _write_index(index: dict[str, list[dict]]) -> None:
    KML_INDEX_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = KML_INDEX_PATH.with_suffix(".json.tmp")
    with open(tmp, "w") as f:
        json.dump(index, f, indent=2)
    tmp.replace(KML_INDEX_PATH)   # atomic: never leave a half-written index


# ── Files ────────────────────────────────────────────────────────────────────

def put_file(data: bytes, filename: str, uploaded_by: Optional[str] = None) -> str:
    """
    Store the uploaded bytes and return the file id.

    Content-addressed: uploading a file already held returns the existing id
    rather than a second copy. That is what makes a whole-system KMZ matched to
    eight segments cost one blob, and makes a re-upload of the same file a
    no-op at the byte level while still creating a new segment_kml version.
    """
    digest = sha256_hex(data)

    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT id FROM kml_files WHERE sha256 = %s", (digest,))
            row = cur.fetchone()
            if row:
                return row["id"]
            file_id = uuid.uuid4().hex
            cur.execute(
                "INSERT INTO kml_files (id, sha256, filename, size_bytes, blob, uploaded_at, uploaded_by)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (file_id, digest, filename, len(data), data, _now(), uploaded_by),
            )
            return file_id

    index = _read_index()
    for rec in index["files"]:
        if rec["sha256"] == digest:
            return rec["id"]
    file_id = uuid.uuid4().hex
    KML_BLOB_DIR.mkdir(parents=True, exist_ok=True)
    (KML_BLOB_DIR / f"{digest}.bin").write_bytes(data)
    index["files"].append({
        "id": file_id, "sha256": digest, "filename": filename,
        "size_bytes": len(data), "uploaded_at": _now(), "uploaded_by": uploaded_by,
    })
    _write_index(index)
    return file_id


def get_file_bytes(file_id: str) -> Optional[tuple[bytes, str]]:
    """Return (blob, filename) for download, or None. Bytes are returned exactly
    as uploaded — the point of keeping the original is that it round-trips."""
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT blob, filename FROM kml_files WHERE id = %s", (file_id,))
            row = cur.fetchone()
            return (bytes(row["blob"]), row["filename"]) if row else None

    index = _read_index()
    rec = next((f for f in index["files"] if f["id"] == file_id), None)
    if not rec:
        return None
    path = KML_BLOB_DIR / f"{rec['sha256']}.bin"
    if not path.exists():
        return None
    return path.read_bytes(), rec["filename"]


# ── Segment links ────────────────────────────────────────────────────────────

def _next_version(segment_id: str) -> int:
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT COALESCE(MAX(version), 0) AS v FROM segment_kml WHERE segment_id = %s",
                (segment_id,),
            )
            return int(cur.fetchone()["v"]) + 1
    links = _read_index()["links"]
    return max((l["version"] for l in links if l["segment_id"] == segment_id), default=0) + 1


def link_segment(
    segment_id: str,
    file_id: str,
    geometry: Any,
    placemark_name: str = "",
    points: Optional[list[dict]] = None,
    created_by: Optional[str] = None,
) -> dict:
    """
    Attach a parsed path to a segment as a NEW VERSION, and make it active.

    Never overwrites: a re-upload is always a new version, so a bad file can be
    rolled back rather than having destroyed the good one it replaced. The
    previous active version is deactivated in the same transaction.
    """
    version = _next_version(segment_id)
    link_id = uuid.uuid4().hex
    row = {
        "id": link_id,
        "segment_id": segment_id,
        "file_id": file_id,
        "version": version,
        "active": True,
        "placemark_name": placemark_name,
        "display_path": geometry.display_path,
        "full_path": geometry.full_path,
        "points": points or [],
        "length_km": geometry.length_km,
        "a_end_gap_km": geometry.a_end_gap_km,
        "z_end_gap_km": geometry.z_end_gap_km,
        "reversed": geometry.reversed_to_match,
        "point_count": len(geometry.full_path),
        "created_at": _now(),
        "created_by": created_by,
    }

    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            # Deactivate first: the partial unique index would reject the insert
            # otherwise, which is the protection working as intended.
            cur.execute("UPDATE segment_kml SET active = FALSE WHERE segment_id = %s AND active",
                        (segment_id,))
            cur.execute(
                "INSERT INTO segment_kml (id, segment_id, file_id, version, active, placemark_name,"
                " display_path, full_path, points, length_km, a_end_gap_km, z_end_gap_km,"
                " reversed, point_count, created_at, created_by)"
                " VALUES (%s,%s,%s,%s,TRUE,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (link_id, segment_id, file_id, version, placemark_name,
                 json.dumps(row["display_path"]), json.dumps(row["full_path"]),
                 json.dumps(row["points"]), row["length_km"], row["a_end_gap_km"],
                 row["z_end_gap_km"], row["reversed"], row["point_count"],
                 row["created_at"], created_by),
            )
        return row

    index = _read_index()
    for l in index["links"]:
        if l["segment_id"] == segment_id:
            l["active"] = False
    index["links"].append(row)
    _write_index(index)
    return row


def active_links() -> dict[str, dict]:
    """Every segment's active row, keyed by segment_id.

    WITHOUT full_path — this feeds the /api/segments payload, and the whole
    reason for two resolutions is that the full one must not ride along. Adding
    it here would silently undo the design and put ~39 MB back on page load.
    """
    cols = ("id, segment_id, file_id, version, placemark_name, display_path, points,"
            " length_km, a_end_gap_km, z_end_gap_km, reversed, point_count, created_at, created_by")
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT {cols} FROM segment_kml WHERE active")
            return {r["segment_id"]: dict(r) for r in cur.fetchall()}

    out = {}
    for l in _read_index()["links"]:
        if l.get("active"):
            out[l["segment_id"]] = {k: v for k, v in l.items() if k != "full_path"}
    return out


def full_path_for(segment_id: str) -> Optional[dict]:
    """The active full-resolution path for one segment — the on-demand half."""
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id, segment_id, file_id, version, full_path, points, length_km,"
                " a_end_gap_km, z_end_gap_km, reversed, point_count, created_at"
                " FROM segment_kml WHERE segment_id = %s AND active",
                (segment_id,),
            )
            row = cur.fetchone()
            return dict(row) if row else None

    for l in _read_index()["links"]:
        if l["segment_id"] == segment_id and l.get("active"):
            return l
    return None


def versions_for(segment_id: str) -> list[dict]:
    """Every version for one segment, newest first — the library's history view."""
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT k.id, k.segment_id, k.file_id, k.version, k.active, k.placemark_name,"
                " k.length_km, k.a_end_gap_km, k.z_end_gap_km, k.reversed, k.point_count,"
                " k.created_at, k.created_by, f.filename, f.size_bytes"
                " FROM segment_kml k JOIN kml_files f ON f.id = k.file_id"
                " WHERE k.segment_id = %s ORDER BY k.version DESC",
                (segment_id,),
            )
            return [dict(r) for r in cur.fetchall()]

    index = _read_index()
    files = {f["id"]: f for f in index["files"]}
    rows = [l for l in index["links"] if l["segment_id"] == segment_id]
    out = []
    for l in sorted(rows, key=lambda r: r["version"], reverse=True):
        rec = {k: v for k, v in l.items() if k not in ("full_path", "display_path", "points")}
        f = files.get(l["file_id"], {})
        rec["filename"] = f.get("filename", "")
        rec["size_bytes"] = f.get("size_bytes", 0)
        out.append(rec)
    return out


def activate(link_id: str) -> Optional[str]:
    """Make one version the active one (rollback). Returns its segment_id."""
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT segment_id FROM segment_kml WHERE id = %s", (link_id,))
            row = cur.fetchone()
            if not row:
                return None
            segment_id = row["segment_id"]
            cur.execute("UPDATE segment_kml SET active = FALSE WHERE segment_id = %s AND active",
                        (segment_id,))
            cur.execute("UPDATE segment_kml SET active = TRUE WHERE id = %s", (link_id,))
            return segment_id

    index = _read_index()
    target = next((l for l in index["links"] if l["id"] == link_id), None)
    if not target:
        return None
    for l in index["links"]:
        if l["segment_id"] == target["segment_id"]:
            l["active"] = False
    target["active"] = True
    _write_index(index)
    return target["segment_id"]


def delete_link(link_id: str) -> Optional[str]:
    """Remove one version. If it was active, the newest remaining takes over —
    a segment must never be left with versions but nothing drawn."""
    if _use_db():
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT segment_id, active FROM segment_kml WHERE id = %s", (link_id,))
            row = cur.fetchone()
            if not row:
                return None
            segment_id, was_active = row["segment_id"], row["active"]
            cur.execute("DELETE FROM segment_kml WHERE id = %s", (link_id,))
            if was_active:
                cur.execute(
                    "UPDATE segment_kml SET active = TRUE WHERE id = ("
                    "  SELECT id FROM segment_kml WHERE segment_id = %s"
                    "  ORDER BY version DESC LIMIT 1)",
                    (segment_id,),
                )
            return segment_id

    index = _read_index()
    target = next((l for l in index["links"] if l["id"] == link_id), None)
    if not target:
        return None
    segment_id, was_active = target["segment_id"], target.get("active", False)
    index["links"] = [l for l in index["links"] if l["id"] != link_id]
    if was_active:
        remaining = [l for l in index["links"] if l["segment_id"] == segment_id]
        if remaining:
            max(remaining, key=lambda r: r["version"])["active"] = True
    _write_index(index)
    return segment_id


def coverage() -> dict[str, int]:
    """How much of the network has geometry — the honest headline for the UI."""
    links = active_links()
    return {"segments_with_kml": len(links)}
