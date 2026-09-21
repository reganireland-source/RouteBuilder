# ─────────────────────────────────────────────────────────────────────────────
# auth.py — authentication check endpoints, for BOTH auth models.
#
# Route prefix: /api/auth  (this router has prefix="/auth"; main.py mounts it
# under "/api", so every path below is /api/auth/...).
#
# This app supports two auth models, selected by the AUTH_MODE environment
# variable (see app/auth/okta.py's auth_mode() and app/main.py's auth_guard,
# which is what actually enforces either of them — nothing in this router
# protects any data itself, it only reports state and, for admin-key mode,
# runs the login handshake):
#
#   admin_key (default) — a single shared admin token. When ADMIN_KEY is set,
#   all write operations (POST/PUT/PATCH/DELETE) require an "x-admin-token"
#   header matching it. When unset, the app runs in "open" (dev) mode.
#
#   okta — every request needs a valid Okta-issued bearer token (whole-app
#   gate, not just writes); write access additionally requires membership in
#   the OKTA_ADMIN_GROUP Okta group. See docs/okta-setup.md for the IT-facing
#   setup checklist and app/auth/okta.py for the verification logic.
#
# Endpoints:
#   POST /api/auth/verify  — admin-key mode: check whether a supplied
#                            x-admin-token is valid.
#   GET  /api/auth/status  — admin-key mode: report whether a token is
#                            required at all. Kept for backward compatibility;
#                            new frontend code should read /config instead,
#                            which answers the same question for BOTH modes.
#   GET  /api/auth/config  — which mode is active, and (in okta mode) the
#                            public OIDC values — issuer, client id — the
#                            frontend needs to redirect the browser to Okta's
#                            login page. Called before the browser has ever
#                            signed in, so it must stay reachable with no
#                            token at all in both modes (see _OKTA_PUBLIC_PATHS
#                            in app/main.py).
# ─────────────────────────────────────────────────────────────────────────────
import os
import secrets
from fastapi import APIRouter, HTTPException
from fastapi import Request

from ..auth.okta import auth_mode, load_okta_settings

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


@router.get("/config")
def auth_config():
    """GET /api/auth/config — how the frontend should authenticate, for
    either mode. The one thing the frontend calls before it knows anything
    else about itself — including before it has ever signed in — so it stays
    reachable with no token in BOTH modes (see _OKTA_PUBLIC_PATHS in
    app/main.py; admin-key mode never required a token for GETs anyway).

    Response, admin_key mode: {"mode": "admin_key", "auth_required": bool} —
    identical information to GET /api/auth/status, just wrapped consistently
    with the okta response below.

    Response, okta mode: {"mode": "okta", "okta": {"issuer", "client_id"} |
    null}. `okta` is null when AUTH_MODE=okta but OKTA_ISSUER/OKTA_CLIENT_ID
    are not set on the server — the frontend shows "not configured yet"
    rather than attempting a redirect to nowhere. issuer/client_id are NOT
    secrets: they are exactly what Okta's own hosted login page needs from
    the browser to start a PKCE flow, and a public OIDC client (a
    single-page app) never holds a client_secret at all.

    Auth: public read endpoint; no token required, in either mode.
    """
    if auth_mode() == "okta":
        settings = load_okta_settings()
        okta = {"issuer": settings.issuer, "client_id": settings.client_id} if settings else None
        return {"mode": "okta", "okta": okta}
    return {"mode": "admin_key", "auth_required": bool(os.getenv("ADMIN_KEY", ""))}
