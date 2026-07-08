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
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT data FROM feature_requests ORDER BY data->>'created_at' ASC")
            return [row["data"] for row in cur.fetchall()]
    finally:
        conn.close()


@router.post("/feature-requests", status_code=201)
def create_feature_request(req: FeatureRequestCreate):
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
