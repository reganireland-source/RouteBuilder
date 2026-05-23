import os
from fastapi import FastAPI  # noqa: F401
from fastapi.middleware.cors import CORSMiddleware
from .api import nodes, segments, systems, routes, capacity, rules, health, config, city_pairs, outages

app = FastAPI(title="RouteBuilder API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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

# NLP route parsing — only registered when NLP_ENABLED=true
if os.getenv("NLP_ENABLED", "").lower() == "true":
    from .api import nlp
    app.include_router(nlp.router, prefix="/api")
