# ─────────────────────────────────────────────────────────────────────────────
# auth.py — Admin authentication check endpoints.
#
# Route prefix: /api/auth  (this router has prefix="/auth"; main.py mounts it
# under "/api", so every path below is /api/auth/...).
#
# This app has a very simple auth model: a single shared admin token. When the
# ADMIN_KEY environment variable is set, all write operations (POST/PUT/DELETE)
# across the whole API require an "x-admin-token" request header whose value
# matches ADMIN_KEY. That check is enforced centrally by the admin_write_guard
# middleware in app/main.py. When ADMIN_KEY is unset, the app runs in "open"
# (dev) mode and no token is required for anything.
#
# The endpoints here just let the frontend probe that state so it can show or
# hide the "unlock admin mode" UI. They do not themselves protect any data.
#
# Endpoints:
#   POST /api/auth/verify  — check whether a supplied x-admin-token is valid.
#   GET  /api/auth/status  — report whether an admin token is required at all.
# ─────────────────────────────────────────────────────────────────────────────
import os
import secrets
from fastapi import APIRouter, HTTPException
from fastapi import Request

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/verify")
async def verify_admin(request: Request):
    """POST /api/auth/verify — validate an admin token (login handshake).

    Reads the "x-admin-token" header from the incoming request and compares it
    against the ADMIN_KEY environment variable.

    Behaviour:
      - If ADMIN_KEY is not set, the backend is in open/dev mode and everyone is
        treated as admin: returns {"status": "ok", "role": "admin",
        "mode": "open"} without checking any header.
      - If ADMIN_KEY is set and the header matches, returns
        {"status": "ok", "role": "admin", "mode": "keyed"}.
      - If ADMIN_KEY is set and the header is missing/wrong, raises HTTP 403.

    Params: none in the URL; the token is passed via the x-admin-token header.
    Response: JSON status object as described above (HTTP 200), or 403 on a bad
    token.

    Auth: this endpoint is itself the auth handshake, so it is one of the EXEMPT
    write paths in app/main.py — it is a POST but requires no admin token to
    reach (otherwise you could never log in). It is rate limited instead.

    (Original one-line summary: verify an admin token; returns 200 if valid or
    if no key is configured.)
    """
    admin_key = os.getenv("ADMIN_KEY", "")
    if not admin_key:
        return {"status": "ok", "role": "admin", "mode": "open"}
    token = request.headers.get("x-admin-token", "")
    if secrets.compare_digest(token.encode(), admin_key.encode()):
        return {"status": "ok", "role": "admin", "mode": "keyed"}
    raise HTTPException(status_code=403, detail="Invalid admin token")


@router.get("/status")
def auth_status():
    """GET /api/auth/status — report whether the backend is locked down.

    Tells the frontend whether an admin token will be required for writes, i.e.
    whether the ADMIN_KEY environment variable is set on the server. The
    frontend uses this to decide whether to show the "unlock admin mode" prompt.

    Params: none.
    Response: {"auth_required": true|false} — true when ADMIN_KEY is set (keyed
    mode), false when the server is in open/dev mode.

    Auth: public read endpoint; no token required.
    """
    return {"auth_required": bool(os.getenv("ADMIN_KEY", ""))}
