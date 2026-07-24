import logging
import os
import secrets
import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .api import nodes, segments, systems, routes, capacity, rules, health, config, city_pairs, outages, bulk, interfaces, projects, tech_lookups, feature_requests, solution_notes, auth as auth_api, outage_parser
from .db import init_db

logger = logging.getLogger("routebuilder.security")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not os.getenv("ADMIN_KEY"):
        logger.warning("ADMIN_KEY is not set — all write endpoints are OPEN. Set ADMIN_KEY in production.")
    if os.getenv("ALLOWED_ORIGINS", "*") == "*":
        logger.warning("ALLOWED_ORIGINS is not set — CORS allows any origin. Set it to your frontend domain in production.")
    init_db()
    yield


app = FastAPI(title="RouteBuilder API", version="0.1.0", lifespan=lifespan)

# ── CORS ──────────────────────────────────────────────────────────────────────
# In production set ALLOWED_ORIGINS to your frontend domain(s), e.g.:
#   ALLOWED_ORIGINS=https://routebuilder.yourcompany.com
_allowed_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Security response headers ──────────────────────────────────────────────────
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
    return response

# ── Request body size cap ──────────────────────────────────────────────────────
# Rejects oversized payloads before they reach a handler. The largest legitimate
# payload is the Outage Parser (several pasted screenshots of one big table);
# 25 MB leaves ample headroom while still bounding abuse.
_MAX_BODY_BYTES = int(os.getenv("MAX_BODY_BYTES", str(25 * 1024 * 1024)))

@app.middleware("http")
async def body_size_limit(request: Request, call_next):
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > _MAX_BODY_BYTES:
        return JSONResponse({"detail": "Request body too large"}, status_code=413)
    return await call_next(request)

# ── Rate limiting (unauthenticated endpoints) ──────────────────────────────────
# Fixed-size sliding window per client IP, applied to the open POST endpoints
# (route/NLP/city-pair searches, feature requests). Protects the LLM API budget
# and blunts scripted abuse. In-memory — per-process, reset on restart.
_RATE_LIMIT = int(os.getenv("RATE_LIMIT_PER_MINUTE", "120"))
_rate_buckets: dict[str, deque] = defaultdict(deque)

def _rate_limited(client_ip: str) -> bool:
    now = time.monotonic()
    bucket = _rate_buckets[client_ip]
    while bucket and now - bucket[0] > 60:
        bucket.popleft()
    if len(bucket) >= _RATE_LIMIT:
        return True
    bucket.append(now)
    return False

# ── Admin write guard ─────────────────────────────────────────────────────────
# Set ADMIN_KEY env var to enforce token on all write (POST/PUT/DELETE) endpoints.
# These paths are exempted because they are query/read operations that happen to use POST.
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
            client_ip = request.client.host if request.client else "unknown"
            if _rate_limited(client_ip):
                return JSONResponse({"detail": "Too many requests — slow down."}, status_code=429)
        else:
            admin_key = os.getenv("ADMIN_KEY", "")
            if admin_key:
                token = request.headers.get("x-admin-token", "")
                if not secrets.compare_digest(token.encode(), admin_key.encode()):
                    return JSONResponse(
                        {"detail": "Admin access required. Unlock admin mode in the app to make changes."},
                        status_code=403,
                    )
    return await call_next(request)

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
