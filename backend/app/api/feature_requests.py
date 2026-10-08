# ─────────────────────────────────────────────────────────────────────────────
# feature_requests.py — User-submitted feedback / feature requests.
#
# Route prefix: /api/feature-requests  (this router has no prefix of its own;
# the paths below start with "/feature-requests", and main.py mounts the router
# under "/api").
#
# Domain: a lightweight feedback inbox. Anyone using the app can file a feature
# request or bug report; each is stored with a generated UUID and a "backlog"
# starting status. This is deliberately open (unauthenticated), so the request
# model caps field lengths to stop it being abused as a free-write blob store.
#
# STORAGE — DUAL MODE (review finding D1/#3)
# ------------------------------------------
# Every other router reaches storage through app/data_loader.py, which
# transparently switches between Postgres (DATABASE_URL set) and the bundled
# JSON files under backend/data/ (DATABASE_URL unset — local dev and the test
# suite). This module used to be the ONE exception: it called db.get_conn()
# directly, so with DATABASE_URL unset psycopg2.connect(None) raised and BOTH
# listing and submitting feedback failed outright in file mode.
#
# The fix below implements the same dual-mode split that data_loader.py does:
#   - DATABASE_URL set   → the original SQL path against the feature_requests
#                          JSONB table (unchanged behaviour in production).
#   - DATABASE_URL unset → read/write backend/data/feature_requests.json,
#                          created on first write, missing == empty list.
#
# LONG TERM this pair of helpers BELONGS IN app/data_loader.py alongside
# load_nodes/save_nodes etc. (that is the module that owns storage access, and
# putting it there would keep the "routers never touch storage directly" rule
# intact). It is inlined here deliberately to keep this change contained to the
# broken file — see review finding D1/#3.
#
# Endpoints:
#   GET  /api/feature-requests  — list all submitted requests (oldest first).
#   POST /api/feature-requests  — submit a new request.
# ─────────────────────────────────────────────────────────────────────────────
import json
import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter()

# Same data directory data_loader.py uses for the other JSON-mode collections.
DATA_DIR = Path(__file__).parent.parent.parent / "data"
FEATURE_REQUESTS_FILE = DATA_DIR / "feature_requests.json"


def _use_db() -> bool:
    """True → Postgres mode; False → JSON-file mode.

    Imported lazily (inside the function), exactly like data_loader._use_db, so
    tests can monkeypatch app.db.DATABASE_URL and flip modes at runtime — a
    module-level `from ..db import DATABASE_URL` would freeze the value at
    import time.
    """
    from ..db import DATABASE_URL
    return bool(DATABASE_URL)


def _load_file_requests() -> list[dict]:
    """JSON-file mode read: return the stored documents, [] if nothing yet.

    A missing file is treated as an empty inbox (nobody has filed feedback on
    this deployment yet) rather than an error. A corrupt/unreadable file would
    raise, which is the honest outcome — we must not silently discard feedback
    by pretending it is empty and then overwriting it.
    """
    if not FEATURE_REQUESTS_FILE.exists():
        return []
    with open(FEATURE_REQUESTS_FILE) as f:
        return json.load(f)


def _save_file_requests(items: list[dict]) -> None:
    """JSON-file mode write: replace the file ATOMICALLY.

    Written to a temp file in the same directory and then os.replace()d over the
    destination: os.replace is atomic on POSIX and Windows, so a reader either
    sees the whole old file or the whole new one, and a crash mid-write cannot
    leave a truncated feature_requests.json behind.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=DATA_DIR, prefix=".feature_requests.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(items, f, indent=2)
        # mkstemp() creates 0600; without this the stored feedback file would be
        # readable only by the writing user, unlike every other file in data/.
        # Preserve the existing mode where there is one, else use 0644.
        try:
            mode = os.stat(FEATURE_REQUESTS_FILE).st_mode & 0o777
        except FileNotFoundError:
            mode = 0o644
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, FEATURE_REQUESTS_FILE)
    except BaseException:
        # Never leave a stray temp file behind if serialisation/replace failed.
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise


class FeatureRequestCreate(BaseModel):
    # This endpoint is deliberately unauthenticated (anyone can file feedback),
    # so field lengths are capped to keep it from being a free-write blob store.
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(max_length=5000)
    category: str = Field(max_length=50)


@router.get("/feature-requests")
def list_feature_requests():
    """GET /api/feature-requests — list all submitted feature requests.

    Params: none.
    Response: a JSON array of feature-request documents (the raw stored payloads:
    id, title, description, category, status, created_at), ordered by created_at
    ascending (oldest first).

    Works in both storage modes (review finding #3): Postgres when DATABASE_URL
    is set, otherwise backend/data/feature_requests.json.

    Auth: public read endpoint; no token required.
    """
    if _use_db():
        from ..db import get_conn
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT data FROM feature_requests ORDER BY data->>'created_at' ASC")
                return [row["data"] for row in cur.fetchall()]
        finally:
            conn.close()

    # JSON-file mode: sort in Python to match the SQL ORDER BY. created_at is an
    # ISO-8601 UTC timestamp, so lexicographic sort == chronological sort.
    items = _load_file_requests()
    return sorted(items, key=lambda i: i.get("created_at") or "")


@router.post("/feature-requests", status_code=201)
def create_feature_request(req: FeatureRequestCreate):
    """POST /api/feature-requests — submit a new feature request / feedback item.

    Builds a document with a fresh UUID, a server-set UTC created_at timestamp,
    and status "backlog", then persists it — as JSONB in Postgres, or appended to
    backend/data/feature_requests.json in file mode (review finding #3).

    Params: request body is a FeatureRequestCreate (title 1-200 chars,
    description up to 5000 chars, category up to 50 chars — length caps because
    the endpoint is open). Title and description are stripped of surrounding
    whitespace before storage.
    Response: the stored item dict (HTTP 201).

    Auth: intentionally OPEN — anyone can submit feedback. It is one of the
    EXEMPT write paths in app/main.py, so no admin token is required even when
    ADMIN_KEY is set; it is rate limited instead.
    """
    item = {
        "id": str(uuid.uuid4()),
        "title": req.title.strip(),
        "description": req.description.strip(),
        "category": req.category,
        "status": "backlog",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    if _use_db():
        from ..db import get_conn
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO feature_requests (id, data) VALUES (%s, %s::jsonb)",
                    (item["id"], json.dumps(item)),
                )
            conn.commit()
        finally:
            conn.close()
    else:
        # Read-modify-write the whole file. Fine at this volume (a feedback
        # inbox), and the write itself is atomic — see _save_file_requests.
        items = _load_file_requests()
        items.append(item)
        _save_file_requests(items)

    return item
