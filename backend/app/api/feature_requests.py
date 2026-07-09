# ─────────────────────────────────────────────────────────────────────────────
# feature_requests.py — User-submitted feedback / feature requests.
#
# Route prefix: /api/feature-requests  (this router has no prefix of its own;
# the paths below start with "/feature-requests", and main.py mounts the router
# under "/api").
#
# Domain: a lightweight feedback inbox. Anyone using the app can file a feature
# request or bug report; each is stored as a JSONB document in the Postgres
# "feature_requests" table with a generated UUID and a "backlog" starting
# status. This is deliberately open (unauthenticated), so the request model caps
# field lengths to stop it being abused as a free-write blob store.
#
# Endpoints:
#   GET  /api/feature-requests  — list all submitted requests (oldest first).
#   POST /api/feature-requests  — submit a new request.
# ─────────────────────────────────────────────────────────────────────────────
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel, Field

from ..db import get_conn

router = APIRouter()


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
    Response: a JSON array of feature-request documents (the raw JSONB payloads:
    id, title, description, category, status, created_at), ordered by created_at
    ascending (oldest first).

    Auth: public read endpoint; no token required.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM feature_requests ORDER BY data->>'created_at' ASC")
            return [row["data"] for row in cur.fetchall()]
    finally:
        conn.close()


@router.post("/feature-requests", status_code=201)
def create_feature_request(req: FeatureRequestCreate):
    """POST /api/feature-requests — submit a new feature request / feedback item.

    Builds a document with a fresh UUID, a server-set UTC created_at timestamp,
    and status "backlog", then inserts it as JSONB into Postgres.

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
    return item
