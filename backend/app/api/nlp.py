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
import logging

from fastapi import APIRouter, HTTPException
from ..models import NlpParseRequest, NlpParseResponse
from ..data_loader import load_nodes, load_segments
from ..nlp.provider import get_provider
from ..nlp.parser import parse_route_request

router = APIRouter(prefix="/nlp", tags=["nlp"])

log = logging.getLogger("routebuilder.nlp")


@router.post("/parse", response_model=NlpParseResponse)
def nlp_parse(request: NlpParseRequest):
    """POST /api/nlp/parse — parse a natural-language route query with an LLM.

    Resolves the configured LLM provider, loads the current nodes and segments
    (so the parser can ground place names against real IDs), and asks the
    provider to convert request.text into a structured NlpParseResponse.

    Params: request body is an NlpParseRequest with a single "text" field — the
    user's free-text query, capped at 2000 characters by the model (finding #19;
    over-long input is rejected with a 422 before any LLM budget is spent).
    Response: an NlpParseResponse (the extracted structured route parameters).
    Errors: HTTP 503 if no LLM provider is configured/available; HTTP 500 with a
    GENERIC message if the provider call or parsing fails — the real exception is
    logged server-side only (finding #19), because upstream SDK errors can carry
    endpoint URLs, request ids and key fragments that must not reach the client.

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
    except Exception:
        # Review finding #19: never echo the raw exception to the client. An LLM
        # SDK error can embed the provider endpoint, deployment name, request id
        # or key fragments; leaking those from an unauthenticated endpoint is an
        # information-disclosure bug. Log the full traceback server-side and
        # return a fixed, generic message.
        log.exception("NLP parse failed")
        raise HTTPException(
            status_code=500,
            detail="Could not parse the query. Please rephrase it or try again.",
        )
