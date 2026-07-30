import logging
import os
import re
import secrets
import time
import uuid
from collections import OrderedDict, deque
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send
from .api import (
    auth as auth_api,
    bulk,
    capacity,
    city_pairs,
    config,
    feature_requests,
    health,
    interfaces,
    nodes,
    outage_parser,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Finding #2: write authorization now fails CLOSED. Make the resulting mode
    # obvious in the logs at boot so a misconfigured deploy is diagnosable from
    # the first log line instead of from a stream of 503s.
    if _admin_key():
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
#   request  ─→ 1. admin_write_guard    (403/503 auth + 429 rate limit)
#            ─→ 2. BodySizeLimit        (413 on oversized bodies)
#            ─→ 3. security_headers     (CSP + hardening headers on responses)
#            ─→ 4. request_context      (correlation id, access log, timing)
#            ─→ 5. CORSMiddleware       (preflight + CORS response headers)
#            ─→ router / endpoint
#   response ←─ unwinds in the reverse order.
#
# Why this order:
#   • CORS outermost  → THIS IS LOAD-BEARING, not stylistic. A prior version had
#     CORS innermost (below admin_write_guard), reasoning that it "still answers
#     preflights before the router is reached." That is true for OPTIONS
#     preflights, but wrong for the actual request: admin_write_guard's 403/503/
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


# ── Admin write guard ─────────────────────────────────────────────────────────
# All write methods require the X-Admin-Token header to match ADMIN_KEY.
# These paths are exempted because they are query/read operations that happen to
# use POST (they are rate limited instead).
#
# Finding #2: this guard used to enforce the token only `if admin_key:` — with
# ADMIN_KEY absent (a fresh deploy, a renamed variable, a dropped env file) every
# POST/PUT/PATCH/DELETE was accepted from anyone. It now fails CLOSED: no key and
# no explicit dev-mode opt-in means writes are refused with 503.
_WRITE_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
_EXEMPT_WRITE_PATHS = {
    "/api/routes",           # route search query
    "/api/nlp/parse",        # NLP query
    "/api/city-pairs/search",# city pair search query
    "/api/feature-requests", # anyone can submit feedback
    "/api/auth/verify",      # auth handshake itself must be open
}


@app.middleware("http")
async def admin_write_guard(request: Request, call_next):
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
    def __init__(self, app: ASGIApp, max_bytes: int = _MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
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
app.include_router(outage_parser.router, prefix="/api")
app.include_router(bulk.router, prefix="/api")
app.include_router(interfaces.router, prefix="/api")
app.include_router(projects.router, prefix="/api")
app.include_router(tech_lookups.router, prefix="/api")
app.include_router(feature_requests.router, prefix="/api")
app.include_router(solution_notes.router, prefix="/api")

# NLP route parsing — only registered when NLP_ENABLED=true
if os.getenv("NLP_ENABLED", "").lower() == "true":
    from .api import nlp
    app.include_router(nlp.router, prefix="/api")
