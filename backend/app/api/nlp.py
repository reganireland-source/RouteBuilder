# ─────────────────────────────────────────────────────────────────────────────
# nlp.py — Natural-language route-query parsing via an LLM.
#
# Route prefix: /api/nlp  (this router has prefix="/nlp"; main.py mounts it
# under "/api", so the path is /api/nlp/parse).
#
# What it does: turns a free-text query like "route from Singapore to Tokyo
# avoiding Japan" into a structured RouteRequest-style object the frontend can
# feed into the normal route search. It calls a configured LLM provider
# (Claude / Azure OpenAI / OpenAI) to do the parsing, giving it the known node
# and segment names as context so it can map place names to IDs.
#
# IMPORTANT: this router is only mounted when the NLP_ENABLED environment
# variable is "true" (see the conditional include_router in app/main.py). If
# NLP is disabled, these paths simply do not exist.
#
# Endpoints:
#   POST /api/nlp/parse  — parse one natural-language route query.
# ─────────────────────────────────────────────────────────────────────────────
from fastapi import APIRouter, HTTPException
from ..models import NlpParseRequest, NlpParseResponse
from ..data_loader import load_nodes, load_segments
from ..nlp.provider import get_provider
from ..nlp.parser import parse_route_request

router = APIRouter(prefix="/nlp", tags=["nlp"])


@router.post("/parse", response_model=NlpParseResponse)
def nlp_parse(request: NlpParseRequest):
    """POST /api/nlp/parse — parse a natural-language route query with an LLM.

    Resolves the configured LLM provider, loads the current nodes and segments
    (so the parser can ground place names against real IDs), and asks the
    provider to convert request.text into a structured NlpParseResponse.

    Params: request body is an NlpParseRequest with a single "text" field — the
    user's free-text query.
    Response: an NlpParseResponse (the extracted structured route parameters).
    Errors: HTTP 503 if no LLM provider is configured/available; HTTP 500 if the
    provider call or parsing fails.

    Auth: this is a read-style query that happens to use POST, so it is one of
    the EXEMPT write paths in app/main.py — no admin token is required even when
    ADMIN_KEY is set. It is rate limited instead (it spends the LLM API budget).
    Note also this route only exists when NLP_ENABLED=true.
    """
    try:
        provider = get_provider()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    nodes = load_nodes()
    segments = load_segments()

    try:
        return parse_route_request(provider, nodes, segments, request.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Parse error: {e}")
