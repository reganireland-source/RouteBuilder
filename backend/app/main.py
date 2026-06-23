import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .api import nodes, segments, systems, routes, capacity, rules, health, config, city_pairs, outages, bulk, interfaces, projects, tech_lookups, feature_requests, solution_notes, auth as auth_api
from .db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

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
    if request.method in _WRITE_METHODS and request.url.path not in _EXEMPT_WRITE_PATHS:
        admin_key = os.getenv("ADMIN_KEY", "")
        if admin_key:
            token = request.headers.get("x-admin-token", "")
            if token != admin_key:
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
