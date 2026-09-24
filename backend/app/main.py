"""
FastAPI application entrypoint for the RouteBuilder backend.

WHAT THIS FILE DOES
--------------------
This module builds the single `app` object that uvicorn/Railway serve. It is
the wiring layer, not business logic: business logic lives in `app/api/*`
(route handlers), `app/pathfinder.py` + `app/graph.py` (route search),
`app/data_loader.py` (storage) and `app/auth/*` (SSO). What lives HERE is:

  1. Logging setup (module-level, runs at import time) — one "routebuilder"
     logger namespace with ".security" and ".access" children.
  2. `lifespan` — startup hook: logs the effective auth mode, calls
     `init_db()` (see app/db.py) and warms the hazard cache in the
     background (see app/hazards/service.py). No app-level shutdown logic.
  3. Five ASGI/HTTP middlewares, registered in a deliberate order (see the
     big banner comment below `app = FastAPI(...)`):
       auth_guard -> BodySizeLimitMiddleware -> security_headers ->
       request_context -> CORSMiddleware
     Read that banner before touching registration order — it documents a
     real production incident (Finding: CORS must be outermost) that
     re-ordering would silently reintroduce.
  4. Router registration — every `app/api/*.py` router is mounted here under
     the `/api` prefix; this is the map from URL path to handler module.

HOW IT'S WIRED INTO THE REST OF THE BACKEND
--------------------------------------------
  * Every request enters through the middleware chain built in this file,
    then dispatches into one of the routers imported from `app/api/`.
  * `auth_guard` (this file) is what makes `app/api/*` handlers trust that a
    request reaching them already passed either the ADMIN_KEY check or SSO
    (Okta/Entra) authentication/authorization — handlers themselves do not
    re-check auth.
  * `app/db.py`'s `init_db()` is called once here at startup; `app/data_loader.py`
    (this backend's storage layer) assumes the schema/migrations it creates
    already exist by the time any request is served.
  * `app/hazards/service.py`'s `warm_in_background()` is kicked off here so the
    hazard-overlay endpoints have cached data ready without the first caller
    paying for a slow upstream fetch.

Nothing in this file talks to `pathfinder.py`/`graph.py`/`data_loader.py`
directly — it only mounts the routers (`routes.router`, `nodes.router`, ...)
that do.
"""
import logging
import os
import re
import secrets
import time
import uuid
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from .auth.oidc import OidcAuthError, OidcVerifier, auth_mode
# NOTE: auth/okta.py and auth/entra.py are NOT imported here at module level —
# see the `if auth_mode() == "okta": ...` block below, which imports each one
# only when that provider is actually selected. This is deliberate for
# enterprise-IT removability: a deployment that only ever runs admin_key or
# one SSO provider can delete the other provider's file (and its unused
# dependency, e.g. an MSAL/Okta SDK) without main.py failing to import.
from .api import (
    auth as auth_api,
    bulk,
    capacity,
    city_pairs,
    config,
    feature_requests,
    health,
    interfaces,
    kml as kml_api,
    nodes,
    outages,
    projects,
    routes,
    rules,
    segments,
    solution_notes,
    systems,
    tech_lookups,
)
from .db import init_db


# ── Optional feature flags ────────────────────────────────────────────────────
# Each of these gates one deploy-time-removable piece that calls an LLM/AI
# service or an external third-party host. All four default to ENABLED (unset
# or anything but the literal string "false" keeps today's always-on
# behaviour) — these are existing always-on features being retrofitted with an
# opt-OUT switch, unlike NLP_ENABLED above which is a newer opt-IN feature.
# An enterprise deployment that wants one of these gone sets the var to
# "false" (which also lets it stop mounting the corresponding router/import,
# so the feature's module can later be deleted outright) — see each flag's
# call site for exactly what it turns off.
def _outage_parser_enabled() -> bool:
    """AI Outage Parser (screenshot/table → structured outages via an LLM
    vision call). False only when OUTAGE_PARSER_ENABLED is exactly "false"."""
    return os.getenv("OUTAGE_PARSER_ENABLED", "").strip().lower() != "false"


def _cable_import_research_enabled() -> bool:
    """Cable Import's "Research" step (Wikipedia fetch + LLM extraction).
    False only when CABLE_IMPORT_RESEARCH_ENABLED is exactly "false"."""
    return os.getenv("CABLE_IMPORT_RESEARCH_ENABLED", "").strip().lower() != "false"


def _hazards_enabled() -> bool:
    """Network Hazards overlay (bushfire.io + USGS external feeds). False
    only when HAZARDS_ENABLED is exactly "false"."""
    return os.getenv("HAZARDS_ENABLED", "").strip().lower() != "false"


def _scm_enabled() -> bool:
    """submarinecablemap.com integration (cable search + geometry sync used
    by KML Chop Import and Cable Import). False only when SCM_ENABLED is
    exactly "false"."""
    return os.getenv("SCM_ENABLED", "").strip().lower() != "false"

# ── Logging setup (Finding #24) ───────────────────────────────────────────────
# One logger namespace for the whole service ("routebuilder"), with two children
# used here: ".security" for auth/misconfiguration events and ".access" for the
# per-request access log. Level comes from LOG_LEVEL (default INFO).
#
# We attach our own StreamHandler only if nothing else has configured this
# namespace, and then stop propagation so we never double-print under uvicorn
# (which installs handlers on the root logger).
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()
_root_logger = logging.getLogger("routebuilder")
_root_logger.setLevel(getattr(logging, _LOG_LEVEL, logging.INFO))
if not _root_logger.handlers:
    _handler = logging.StreamHandler()
    _handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    )
    _root_logger.addHandler(_handler)
    _root_logger.propagate = False

logger = logging.getLogger("routebuilder.security")
access_logger = logging.getLogger("routebuilder.access")


# ── Configuration helpers ─────────────────────────────────────────────────────
# These read the environment on every call rather than caching at import time so
# that tests (and a future hot-reload) see changes without re-importing, and so
# there is exactly one definition of "is this key set / is dev mode on".
def _admin_key() -> str:
    """The configured admin token, or "" when ADMIN_KEY is unset/blank."""
    return os.getenv("ADMIN_KEY", "").strip()


def _open_writes_allowed() -> bool:
    """
    True only when ALLOW_OPEN_WRITES is exactly "true".

    This is the explicit, deliberate opt-out that lets a developer run the API
    with no admin token at all. Anything else (unset, "1", "yes", "True") is
    treated as "not enabled" — a typo must never silently open up writes.
    """
    return os.getenv("ALLOW_OPEN_WRITES", "") == "true"


# Built ONCE at import time when AUTH_MODE is "okta" or "entra", not
# per-request — see OidcVerifier's own docstring on why re-creating it per
# request would throw away its signing-key cache and turn every request into
# a round trip to the identity provider. None when AUTH_MODE is admin_key,
# or when it's an SSO mode but that provider's own required variables are
# unset — auth_guard's own check on this treats that as "SSO mode requested
# but not yet configured" and fails closed (503), the same shape of failure
# ADMIN_KEY being unset already produces today.
if auth_mode() == "okta":
    from .auth.okta import load_okta_settings
    _oidc_settings = load_okta_settings()
elif auth_mode() == "entra":
    from .auth.entra import load_entra_settings
    _oidc_settings = load_entra_settings()
else:
    _oidc_settings = None
_oidc_verifier = OidcVerifier(_oidc_settings) if _oidc_settings else None


def _bearer_token(request: Request) -> str:
    """The token from an `Authorization: Bearer <token>` header, or "" if the
    header is absent or doesn't use the Bearer scheme."""
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan hook: runs once at process startup (the code before
    `yield`) and once at shutdown (after `yield`, which here is empty — there
    is no shutdown cleanup).

    Startup responsibilities:
      * Log the effective auth mode (okta/entra/admin_key/open-dev/misconfigured)
        so a bad deploy is diagnosable from the first log line.
      * Warn loudly if CORS is wide open (ALLOWED_ORIGINS="*").
      * Call `init_db()` (app/db.py) to run/verify schema migrations before
        any request is served.
      * Kick off `warm_hazard_cache()` (app/hazards/service.py) — non-blocking,
        so a slow or unreachable upstream hazard feed never delays boot.
    """
    # Finding #2: write authorization now fails CLOSED. Make the resulting mode
    # obvious in the logs at boot so a misconfigured deploy is diagnosable from
    # the first log line instead of from a stream of 503s.
    if auth_mode() in ("okta", "entra"):
        provider_label = "Okta" if auth_mode() == "okta" else "Entra ID"
        setup_doc = "docs/okta-setup.md" if auth_mode() == "okta" else "docs/entra-setup.md"
        required_vars = "OKTA_ISSUER/OKTA_CLIENT_ID" if auth_mode() == "okta" else "ENTRA_TENANT_ID/ENTRA_CLIENT_ID"
        if _oidc_settings is not None:
            claim_note = (
                f"{_oidc_settings.admin_claim_type}={_oidc_settings.admin_claim_value!r}"
                if _oidc_settings.admin_claim_value
                else f"no admin {_oidc_settings.admin_claim_type} configured — nobody will be granted admin access"
            )
            logger.info(
                "AUTH_MODE=%s — every request requires a valid %s session "
                "(issuer %s). %s.", auth_mode(), provider_label, _oidc_settings.issuer, claim_note,
            )
        else:
            logger.error(
                "AUTH_MODE=%s but %s are not set — every request will be "
                "REFUSED with 503 (fail closed). See %s.",
                auth_mode(), required_vars, setup_doc,
            )
    elif _admin_key():
        logger.info(
            "ADMIN_KEY is set — write endpoints require the X-Admin-Token header."
        )
    elif _open_writes_allowed():
        logger.warning(
            "INSECURE DEV MODE: ADMIN_KEY is not set and ALLOW_OPEN_WRITES=true — "
            "every write endpoint is OPEN to anyone who can reach this process. "
            "NEVER set ALLOW_OPEN_WRITES in a deployed environment."
        )
    else:
        logger.error(
            "ADMIN_KEY is not set — all write endpoints will be REFUSED with 503 "
            "(fail closed). Set ADMIN_KEY to enable writes, or ALLOW_OPEN_WRITES=true "
            "for local development only."
        )
    if "*" in _allowed_origins:
        logger.warning(
            "ALLOWED_ORIGINS is '*' — CORS allows any origin to call this API from a "
            "browser. Set ALLOWED_ORIGINS to your frontend domain(s) in production."
        )
    init_db()
    # Build the hazard cache before anyone asks for it — see warm_in_background.
    # Non-blocking and failure-tolerant: boot never waits on a third-party feed.
    # Only imported/called when the feature is enabled (see _hazards_enabled)
    # so a deployment with HAZARDS_ENABLED=false never touches hazards/service.py.
    if _hazards_enabled():
        from .hazards.service import warm_in_background as warm_hazard_cache
        warm_hazard_cache()
    yield


app = FastAPI(title="RouteBuilder API", version="0.1.0", lifespan=lifespan)

# ══════════════════════════════════════════════════════════════════════════════
# MIDDLEWARE  —  ORDER MATTERS
#
# Starlette prepends each `add_middleware` / `@app.middleware("http")` call to
# the stack, so the LAST one registered is the OUTERMOST (it sees the request
# first and the response last). The registrations below are therefore written
# inner → outer, and the resulting execution order is:
#
#   request  ─→ 1. auth_guard           (401/403/503 auth + 429 rate limit)
#            ─→ 2. BodySizeLimit        (413 on oversized bodies)
#            ─→ 3. security_headers     (CSP + hardening headers on responses)
#            ─→ 4. request_context      (correlation id, access log, timing)
#            ─→ 5. CORSMiddleware       (preflight + CORS response headers)
#            ─→ router / endpoint
#   response ←─ unwinds in the reverse order.
#
# auth_guard (renamed from admin_write_guard when AUTH_MODE=okta support was
# added) runs ONE of two entirely different checks depending on auth_mode():
# the original admin-key model (gates writes only, one shared secret) or, in
# "okta"/"entra" mode, EVERY request needs a valid SSO bearer token and write
# methods additionally need the configured admin group/role — see
# app/auth/oidc.py, app/auth/okta.py, app/auth/entra.py, docs/okta-setup.md
# and docs/entra-setup.md. The exemption/ordering reasoning below predates
# okta mode but applies identically to both SSO modes.
#
# Why this order:
#   • CORS outermost  → THIS IS LOAD-BEARING, not stylistic. A prior version had
#     CORS innermost (below auth_guard), reasoning that it "still answers
#     preflights before the router is reached." That is true for OPTIONS
#     preflights, but wrong for the actual request: auth_guard's 401/403/503/
#     429 short-circuits return directly without calling `call_next`, so they
#     never reached CORSMiddleware at all — the response left the server with
#     NO Access-Control-Allow-Origin header. A browser cannot tell that response
#     apart from a network failure, so fetch() throws a generic
#     "TypeError: Failed to fetch" and the real 403/503/429 status and detail
#     message are invisible to the frontend and to the user. This was caught
#     live: the Outage Parser's "Accept All & Replace" (an authenticated write)
#     failed with exactly this symptom against production, where ADMIN_KEY
#     produces a 503 fail-closed response. Moving CORS outermost means it wraps
#     `send` for every response that leaves the process, including ones
#     generated by inner middleware — so a blocked write now arrives at the
#     browser as a readable 403/503/429 body instead of an opaque network error.
#     Trade-off: CORSMiddleware answers OPTIONS preflights itself and never
#     forwards them further in, so preflight requests no longer get an access-
#     log line from request_context. That's an acceptable loss — preflights
#     carry no business logic — and is standard practice for CORS in Starlette.
#   • security_headers next after CORS → CSP and friends are still attached to
#     every response CORS lets through, including the short-circuits.
#   • body cap before auth → an oversized body is dropped as cheaply as
#     possible, before any token comparison or handler work.
# ══════════════════════════════════════════════════════════════════════════════

# ── Rate limiting (unauthenticated endpoints) ──────────────────────────────────
# Fixed-size sliding window per client IP, applied to the open POST endpoints
# (route/NLP/city-pair searches, feature requests). Protects the LLM API budget
# and blunts scripted abuse. In-memory — per-process, reset on restart.
#
# Finding #18: the previous implementation used a defaultdict that only ever
# grew (one permanent entry per IP ever seen — an unauthenticated memory leak),
# and keyed on request.client.host, which behind Railway's proxy is the proxy
# itself, so every user in the world shared a single 120/min bucket.
_RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "120"))
_RATE_WINDOW_SECONDS = 60.0
# Hard backstop on distinct tracked IPs. At ~10k buckets the memory footprint is
# trivial, and an attacker rotating source IPs can no longer grow the dict
# without bound — the oldest bucket is evicted instead.
_MAX_RATE_BUCKETS = int(os.getenv("RATE_LIMIT_MAX_BUCKETS", "10000"))
# Ordered by last write, so popitem(last=False) evicts the least-recently-active.
_rate_buckets: "OrderedDict[str, deque]" = OrderedDict()
_last_bucket_sweep = 0.0

# Finding #18: TRUST_PROXY_HEADERS defaults to trusting X-Forwarded-For because
# this service is deployed behind Railway's edge proxy, which always sets it and
# strips any client-supplied value. The trade-off is explicit: if the app is ever
# exposed directly to the internet, a client can forge X-Forwarded-For and
# trivially evade the rate limit by rotating the header. Set
# TRUST_PROXY_HEADERS=false in that deployment so only the real peer address is
# used. (This header is only ever used for rate-limit bucketing and logging —
# never for authorization decisions.)
def _trust_proxy_headers() -> bool:
    """True unless TRUST_PROXY_HEADERS is explicitly set to "false".

    Defaults to trusting X-Forwarded-For (see the Finding #18 comment above)
    because this service normally sits behind a proxy that sets and
    sanitises that header. Any value other than a literal "false" (unset,
    "true", "1", a typo) keeps the trusting default.
    """
    return os.getenv("TRUST_PROXY_HEADERS", "").strip().lower() != "false"


def _client_ip(request: Request) -> str:
    """Best-effort client address: left-most X-Forwarded-For entry, else the peer."""
    if _trust_proxy_headers():
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            # Left-most entry is the original client; the rest are proxy hops.
            candidate = forwarded.split(",")[0].strip()
            if candidate:
                return candidate[:64]
    return request.client.host if request.client else "unknown"


def _sweep_rate_buckets(now: float) -> None:
    """
    Periodically drop buckets whose window has fully expired.

    Deleting an emptied bucket inline (see _rate_limited) only helps for IPs that
    come back; this sweep is what reclaims the one-shot visitors. Runs at most
    once per window, so the O(n) scan is amortised to nothing.
    """
    global _last_bucket_sweep
    if now - _last_bucket_sweep < _RATE_WINDOW_SECONDS:
        return
    _last_bucket_sweep = now
    stale = [
        ip
        for ip, b in _rate_buckets.items()
        if not b or now - b[-1] > _RATE_WINDOW_SECONDS
    ]
    for ip in stale:
        del _rate_buckets[ip]


def _rate_limited(client_ip: str) -> bool:
    """Sliding-window rate-limit check/record for one client IP.

    Returns True if `client_ip` has already made `_RATE_LIMIT` requests within
    the trailing `_RATE_WINDOW_SECONDS`, i.e. this request must be rejected
    with 429; otherwise records this request's timestamp and returns False.

    Implementation: each IP gets a `deque` of request timestamps (monotonic
    clock). On every call, timestamps older than the window are popped off the
    left before counting, so the window "slides" rather than resetting on a
    fixed boundary. `_rate_buckets` is an OrderedDict kept in
    least-recently-used order (`move_to_end` on every touch) so the eviction
    backstop at the end can cheaply drop the coldest bucket first with
    `popitem(last=False)` once `_MAX_RATE_BUCKETS` is exceeded — bounding
    memory even under an IP-rotating abuser. Side effect: mutates
    `_rate_buckets` (the module-level state) on every call.
    """
    now = time.monotonic()
    _sweep_rate_buckets(now)

    bucket = _rate_buckets.get(client_ip)
    if bucket is not None:
        while bucket and now - bucket[0] > _RATE_WINDOW_SECONDS:
            bucket.popleft()
        if not bucket:
            # Finding #18: an empty bucket carries no information — delete it
            # rather than leaving a permanent entry per IP ever seen.
            del _rate_buckets[client_ip]
            bucket = None
    if bucket is None:
        bucket = deque()

    if len(bucket) >= _RATE_LIMIT:
        _rate_buckets[client_ip] = bucket
        _rate_buckets.move_to_end(client_ip)
        return True

    bucket.append(now)
    _rate_buckets[client_ip] = bucket
    _rate_buckets.move_to_end(client_ip)
    # Backstop: evict least-recently-active buckets if we somehow blow the cap.
    while len(_rate_buckets) > _MAX_RATE_BUCKETS:
        _rate_buckets.popitem(last=False)
    return False


# ── Auth guard ─────────────────────────────────────────────────────────────────
# Two entirely different checks live here, selected by auth_mode(). The
# ADMIN-KEY check (unchanged from before AUTH_MODE existed): all write methods
# require the X-Admin-Token header to match ADMIN_KEY; a handful of paths are
# exempted because they are query/read operations that happen to use POST
# (rate limited instead). The SSO check (see _sso_auth_check below — shared
# by both "okta" and "entra" modes, since the check itself has no
# provider-specific logic once _oidc_verifier is built) is a strictly bigger
# ask: EVERY request, including plain GETs, needs a valid SSO session.
#
# Finding #2: the admin-key check used to enforce the token only `if
# admin_key:` — with ADMIN_KEY absent (a fresh deploy, a renamed variable, a
# dropped env file) every POST/PUT/PATCH/DELETE was accepted from anyone. It
# now fails CLOSED: no key and no explicit dev-mode opt-in means writes are
# refused with 503. The SSO check applies the identical philosophy: an SSO
# mode requested but not configured (missing OKTA_ISSUER/OKTA_CLIENT_ID or
# ENTRA_TENANT_ID/ENTRA_CLIENT_ID) also fails closed with 503, never open.
_WRITE_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
_EXEMPT_WRITE_PATHS = {
    "/api/routes",           # route search query
    "/api/nlp/parse",        # NLP query
    "/api/city-pairs/search",# city pair search query
    "/api/feature-requests", # anyone can submit feedback
    "/api/auth/verify",      # auth handshake itself must be open
}
# Reachable with NO SSO session at all, even though okta/entra mode otherwise
# gates every other request. Kept to the bare minimum: the two health
# endpoints already documented as public probes in app/api/health.py
# (Railway's readiness/liveness checks have no SSO token to send) and the
# config endpoint the frontend calls BEFORE it has ever logged in, to learn
# where to send the browser to sign in.
_SSO_PUBLIC_PATHS = {
    "/api/health",
    "/api/health/live",
    "/api/auth/config",
}

#: Provider-facing copy for the two failure messages below — keyed by
#: auth_mode()'s own return value, so a typo can't silently fall through to
#: the wrong provider's wording (see auth_mode()'s docstring on why an
#: unrecognised AUTH_MODE value is never "okta" or "entra" in the first place).
_SSO_PROVIDER_LABEL = {"okta": "Okta", "entra": "Entra ID"}
_SSO_ADMIN_NOUN = {"okta": "group", "entra": "role"}
_SSO_REQUIRED_VARS = {
    "okta": "OKTA_ISSUER/OKTA_CLIENT_ID",
    "entra": "ENTRA_TENANT_ID/ENTRA_CLIENT_ID",
}


def _sso_auth_check(request: Request) -> Optional[JSONResponse]:
    """
    The SSO-mode half of auth_guard — identical for "okta" and "entra",
    since by the time this runs _oidc_verifier already encapsulates
    everything provider-specific. Returns a JSONResponse to short-circuit
    the request, or None to let it through to call_next().

    Every request needs a valid bearer token — a whole-app gate, per the
    organisation's own choice of scope, unlike admin-key mode where only
    writes were ever gated. Write methods additionally need the configured
    admin group/role, UNLESS the path is one of _EXEMPT_WRITE_PATHS: those
    are read-shaped actions that only happen to use POST, reachable by any
    authenticated user in admin-key mode too — SSO mode keeps that the same,
    it just adds "authenticated" as a new precondition that didn't exist
    before.
    """
    if request.url.path in _SSO_PUBLIC_PATHS:
        return None
    mode = auth_mode()
    provider = _SSO_PROVIDER_LABEL.get(mode, "SSO")
    if _oidc_verifier is None:
        return JSONResponse(
            {
                "detail": f"{provider} sign-in is not configured on the server "
                          f"(AUTH_MODE={mode} but {_SSO_REQUIRED_VARS.get(mode, '')} are unset)."
            },
            status_code=503,
        )
    token = _bearer_token(request)
    if not token:
        return JSONResponse({"detail": "Sign in required."}, status_code=401)
    try:
        claims = _oidc_verifier.verify(token)
    except OidcAuthError:
        return JSONResponse(
            {"detail": "Your session has expired or is invalid. Please sign in again."},
            status_code=401,
        )
    needs_admin = request.method in _WRITE_METHODS and request.url.path not in _EXEMPT_WRITE_PATHS
    if needs_admin and not _oidc_verifier.is_admin(claims):
        noun = _SSO_ADMIN_NOUN.get(mode, "group")
        return JSONResponse(
            {
                "detail": f"Admin access required. Ask your {provider} administrator "
                          f"to add you to the admin {noun}."
            },
            status_code=403,
        )
    return None


@app.middleware("http")
async def auth_guard(request: Request, call_next):
    """The innermost middleware (runs first on the way in): gates writes (and,
    in SSO mode, every request) before any handler or other middleware sees
    the request. Two entirely different code paths depending on auth_mode():

      * "okta" / "entra": rate-limit the open/exempt POST endpoints, then
        delegate the actual auth/authorization decision to `_sso_auth_check`.
        A non-None result from that check short-circuits the request.
      * anything else (the original admin-key model): only _WRITE_METHODS are
        gated. Exempt paths are rate-limited instead of authenticated. Every
        other write must present X-Admin-Token matching ADMIN_KEY (compared
        with `secrets.compare_digest` to avoid a timing side-channel), unless
        ALLOW_OPEN_WRITES=true (explicit insecure dev mode) or ADMIN_KEY is
        unset (in which case writes fail closed with 503 — see Finding #2).

    Returns either a short-circuiting JSONResponse or the downstream
    `await call_next(request)` result.
    """
    if auth_mode() in ("okta", "entra"):
        if request.url.path in _EXEMPT_WRITE_PATHS and _rate_limited(_client_ip(request)):
            return JSONResponse(
                {"detail": "Too many requests — slow down."}, status_code=429
            )
        blocked = _sso_auth_check(request)
        if blocked is not None:
            return blocked
        return await call_next(request)

    if request.method in _WRITE_METHODS:
        if request.url.path in _EXEMPT_WRITE_PATHS:
            if _rate_limited(_client_ip(request)):
                return JSONResponse(
                    {"detail": "Too many requests — slow down."}, status_code=429
                )
        else:
            admin_key = _admin_key()
            if admin_key:
                # Constant-time comparison: never leak the token via timing.
                token = request.headers.get("x-admin-token", "")
                if not secrets.compare_digest(token.encode(), admin_key.encode()):
                    return JSONResponse(
                        {
                            "detail": "Admin access required. Unlock admin mode in "
                                      "the app to make changes."
                        },
                        status_code=403,
                    )
            elif _open_writes_allowed():
                # INSECURE DEV MODE — explicitly requested via ALLOW_OPEN_WRITES=true.
                pass
            else:
                # Fail closed. 503 (not 403) because the fault is the server's
                # configuration, not the caller's credentials. The detail says
                # which variable is missing and nothing more — no environment
                # dump, no hints about other settings.
                return JSONResponse(
                    {
                        "detail": "Write access is disabled: the server is "
                                  "misconfigured (ADMIN_KEY is not set)."
                    },
                    status_code=503,
                )
    return await call_next(request)


# ── Request body size cap ──────────────────────────────────────────────────────
# Rejects oversized payloads before they reach a handler. The largest legitimate
# payload is the Outage Parser (several pasted screenshots of one big table);
# 25 MB leaves ample headroom while still bounding abuse.
#
# Finding #25: the previous version only checked the Content-Length header, so a
# client using `Transfer-Encoding: chunked` (or simply lying about the length)
# bypassed the cap entirely and could stream unbounded data into memory. The cap
# is now enforced on bytes actually received, with the header kept as a cheap
# pre-check that avoids reading anything at all in the common case.
#
# This is a raw ASGI middleware rather than a BaseHTTPMiddleware because it has
# to wrap the receive channel, which BaseHTTPMiddleware's dispatch signature does
# not expose.
_MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", str(25 * 1024 * 1024)))
_TOO_LARGE_BODY = b'{"detail":"Request body too large"}'
_TOO_LARGE_START: Message = {
    "type": "http.response.start",
    "status": 413,
    "headers": [
        (b"content-type", b"application/json"),
        (b"content-length", str(len(_TOO_LARGE_BODY)).encode()),
    ],
}


class BodySizeLimitMiddleware:
    """Raw ASGI middleware that rejects request bodies larger than `max_bytes`
    with HTTP 413, enforced on bytes actually received rather than trusting
    the client-supplied Content-Length header (see the Finding #25 comment
    above for why the header alone is not enough). Implemented as a raw ASGI
    callable — not `BaseHTTPMiddleware` — specifically because it needs to
    wrap the `receive` channel to count body bytes as they stream in, which
    `BaseHTTPMiddleware`'s dispatch signature does not expose.
    """

    def __init__(self, app: ASGIApp, max_bytes: int = _MAX_BODY_BYTES) -> None:
        """Store the wrapped ASGI app and the byte ceiling (defaults to the
        module-level `_MAX_BODY_BYTES`, itself driven by MAX_BODY_BYTES)."""
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        """ASGI entrypoint. Non-HTTP scopes (e.g. lifespan, websocket) pass
        straight through unmodified. For HTTP requests: fast-reject an
        honestly oversized Content-Length without reading any body bytes,
        otherwise wrap `receive`/`send` (see `limited_receive`/`guarded_send`
        below) so an over-budget body is caught mid-stream and answered with
        a single 413, and any exception the wrapped app raises as a result of
        that forced disconnect is swallowed rather than surfaced as a 500."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Fast path: an honest, oversized Content-Length is rejected without
        # reading a single body byte.
        for key, value in scope.get("headers", []):
            if key == b"content-length":
                declared = value.decode("latin-1").strip()
                if declared.isdigit() and int(declared) > self.max_bytes:
                    await self._reject(send)
                    return
                break

        received = 0
        rejected = False
        response_started = False

        async def limited_receive() -> Message:
            """Wraps `receive`, tallying body bytes as they arrive. Once the
            running total exceeds `self.max_bytes`, sends the 413 response
            itself (only once, guarded by `rejected`) and reports an
            `http.disconnect` to the wrapped app instead of the real message,
            so the app's own body-reading code stops rather than buffering an
            unbounded amount of data."""
            nonlocal received, rejected
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes and not rejected:
                    # Answer 413 ourselves and tell the app the client is gone;
                    # anything it raises on the way out is swallowed below.
                    rejected = True
                    if not response_started:
                        await self._reject(send)
                    return {"type": "http.disconnect"}
            return message

        async def guarded_send(message: Message) -> None:
            """Wraps `send`, dropping anything the app tries to emit after we
            have already answered with our own 413 — prevents writing two
            responses onto the same connection. Also tracks whether a
            response has started, so `limited_receive` knows whether it is
            still safe to send the 413 itself."""
            nonlocal response_started
            if rejected:
                # We already sent the 413 — drop whatever the app emits so we
                # never write two responses onto one connection.
                return
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, guarded_send)
        except BaseException:
            # A cut-off body typically surfaces downstream as ClientDisconnect
            # (or whatever the handler raises when its read fails). Once we have
            # answered 413 that noise is expected and must not become a 500.
            if not rejected:
                raise

    @staticmethod
    async def _reject(send: Send) -> None:
        """Send the pre-built 413 "Request body too large" response (status
        line + headers, then the fixed JSON body) over the given ASGI `send`
        channel. `dict(_TOO_LARGE_START)` copies the module-level message so
        nothing downstream can mutate the shared template."""
        await send(dict(_TOO_LARGE_START))
        await send({"type": "http.response.body", "body": _TOO_LARGE_BODY})


app.add_middleware(BodySizeLimitMiddleware)


# ── Security response headers ──────────────────────────────────────────────────
# Finding #4: added a Content-Security-Policy. This service returns JSON only —
# it never serves HTML, scripts, styles or frames — so the policy can deny
# everything outright. That neutralises the residual risk of a browser being
# tricked into rendering an API response as a document (e.g. a reflected value in
# an error body), and blocks framing/base-tag tricks.
# Override with CONTENT_SECURITY_POLICY if this process ever serves a UI.
_CSP = os.getenv(
    "CONTENT_SECURITY_POLICY",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Attach hardening headers (CSP, X-Content-Type-Options, X-Frame-Options,
    Referrer-Policy, HSTS) to every outgoing response, after the handler (or
    an inner middleware short-circuit) has produced it. See the `_CSP`
    comment above for why the Content-Security-Policy can safely deny
    everything (this service returns JSON only, never HTML/JS/CSS)."""
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = _CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = (
        "max-age=63072000; includeSubDomains"
    )
    return response


# ── Request correlation id + access log ────────────────────────────────────────
# Finding #24: there was no operational logging at all, so an incident could not
# be reconstructed and a user-reported failure could not be tied to a server
# event. Every request now gets a correlation id (reusing an inbound
# X-Request-ID when the caller supplies one, so ids survive across the frontend
# and any proxy), which is echoed back on the response and stamped on one
# structured log line per request.
#
# What is deliberately NOT logged: header values (the admin token lives in
# X-Admin-Token), the query string (searches can carry sensitive site names and
# a future ?token= would be captured forever), cookies, and bodies. Only method,
# route path, status, duration, correlation id and client IP.
_REQUEST_ID_SAFE = re.compile(r"[^A-Za-z0-9._-]")
_MAX_REQUEST_ID_LEN = 64


def _correlation_id(request: Request) -> str:
    """
    Reuse the inbound X-Request-ID, sanitised, else mint a short uuid.

    Sanitising matters: the value is written back into a response header, so
    control characters must never survive (header/response-splitting), and the
    length is capped so a caller cannot inflate every log line.
    """
    inbound = request.headers.get("x-request-id", "")
    if inbound:
        cleaned = _REQUEST_ID_SAFE.sub("", inbound)[:_MAX_REQUEST_ID_LEN]
        if cleaned:
            return cleaned
    return uuid.uuid4().hex[:12]


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Stamp every request with a correlation id and emit one structured
    access-log line per request, on both success and failure paths (the
    logging happens in a `finally` so an exception from `call_next` still
    gets logged, with status_code left at its 500 default in that case).
    The correlation id is exposed on `request.state.request_id` for handlers
    to echo into error payloads, and echoed back as the `X-Request-ID`
    response header. See the Finding #24 comment above for what is
    deliberately NOT logged (headers, query strings, cookies, bodies)."""
    request_id = _correlation_id(request)
    # Exposed on request.state so handlers can include the id in error payloads.
    request.state.request_id = request_id
    client_ip = _client_ip(request)
    started = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        duration_ms = (time.perf_counter() - started) * 1000
        access_logger.info(
            'method=%s path=%s status=%d duration_ms=%.1f request_id=%s client_ip=%s',
            request.method,
            request.url.path,
            status_code,
            duration_ms,
            request_id,
            client_ip,
        )


# ── CORS ──────────────────────────────────────────────────────────────────────
# Registered LAST so it is the OUTERMOST middleware — see the big comment block
# above for why this is load-bearing, not stylistic.
# In production set ALLOWED_ORIGINS to your frontend domain(s), e.g.:
#   ALLOWED_ORIGINS=https://routebuilder.yourcompany.com
# Finding #2: the "*" default is kept for backwards compatibility, but the
# lifespan hook above logs a loud warning whenever it is in effect.
_allowed_origins = [
    o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    # Finding #24: let browser clients read the correlation id so a user-visible
    # error can be tied back to a server log line.
    expose_headers=["X-Request-ID"],
)


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_api.router, prefix="/api")
app.include_router(nodes.router, prefix="/api")
app.include_router(segments.router, prefix="/api")
app.include_router(systems.router, prefix="/api")
app.include_router(routes.router, prefix="/api")
app.include_router(capacity.router, prefix="/api")
app.include_router(rules.router, prefix="/api")
app.include_router(health.router, prefix="/api")
app.include_router(config.router, prefix="/api")
app.include_router(city_pairs.router, prefix="/api")
app.include_router(outages.router, prefix="/api")
app.include_router(bulk.router, prefix="/api")
app.include_router(interfaces.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(tech_lookups.router, prefix="/api")
app.include_router(feature_requests.router, prefix="/api")
app.include_router(solution_notes.router, prefix="/api")
app.include_router(kml_api.router, prefix="/api")

# NLP route parsing — only registered when NLP_ENABLED=true
if os.getenv("NLP_ENABLED", "").lower() == "true":
    from .api import nlp
    app.include_router(nlp.router, prefix="/api")

# AI Outage Parser — an LLM vision call; the whole router is one feature, so
# skipping app.include_router (and the import) is enough to remove it, no
# per-endpoint gating needed. Unmounted means the frontend's calls 404.
if _outage_parser_enabled():
    from .api import outage_parser
    app.include_router(outage_parser.router, prefix="/api")

# Network Hazards overlay — external bushfire.io/USGS feeds, one self
# contained router (app/api/hazards.py + app/hazards/*).
if _hazards_enabled():
    from .api import hazards
    app.include_router(hazards.router, prefix="/api")

# Cable Import "Research" — app/api/cableimport.py has exactly one endpoint
# (POST /api/cableimport/research) and it's entirely an LLM call, so the
# whole router is skippable the same way outage_parser's is. The rest of
# Cable Import (system/node/segment creation) reuses the ordinary
# systems/nodes/segments routers above and is unaffected.
if _cable_import_research_enabled():
    from .api import cableimport
    app.include_router(cableimport.router, prefix="/api")
