from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api import nodes, segments, systems, routes, capacity, rules

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


@app.get("/health")
def health():
    return {"status": "ok"}
