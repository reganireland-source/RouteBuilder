# ─────────────────────────────────────────────────────────────────────────────
# cableimport.py — Cable Import Phase 3: aggregated research for a named cable.
#
# Route prefix: /api/cableimport (this router has prefix="/cableimport";
# main.py mounts it under "/api", so the path is /api/cableimport/research).
#
# CONDITIONAL MOUNTING: main.py only includes this router when the
# CABLE_IMPORT_RESEARCH_ENABLED deploy-time feature flag is true (the
# default). When it's false this module's route never runs at all; that
# gating lives in main.py, not here, so this module itself is unchanged
# either way.
#
# What it does: given a cable name, gathers whatever public source text is
# actually reachable (currently Wikipedia — see app/cableimport/research.py's
# own header for why submarinenetworks.com isn't the source, despite being
# the obvious first choice) and asks the configured LLM provider to extract
# structured facts a human can review and edit. Nothing here writes to the
# database — the result only ever pre-fills the Cable Import wizard's step 1.
#
# Endpoints:
#   POST /api/cableimport/research — research one cable by name.
# ─────────────────────────────────────────────────────────────────────────────
import logging

from fastapi import APIRouter, HTTPException
from ..models import CableResearchRequest, CableResearchResult
from ..nlp.provider import get_provider
from ..cableimport.research import research_cable

router = APIRouter(prefix="/cableimport", tags=["cableimport"])

log = logging.getLogger("routebuilder.cableimport")


@router.post("/research", response_model=CableResearchResult)
def research(request: CableResearchRequest):
    """POST /api/cableimport/research — research a named cable system.

    Params: request body is a CableResearchRequest ({"cable_name": str}).
    Response: a CableResearchResult with whatever facts could be gathered.
    Every field is a PROPOSAL for the Cable Import wizard to pre-fill, never
    authoritative — "confidence" and "notes" say how much to trust it, and
    "sources_used" says where it came from ("wikipedia" and/or
    "model_knowledge", the latter always present as the fallback of last
    resort — see research_cable()'s own docstring).
    Errors: HTTP 503 if no LLM provider is configured. HTTP 500 with a
    GENERIC message on any other failure — the real exception is logged
    server-side only, matching /api/nlp/parse's reasoning: an LLM SDK error
    can carry endpoint URLs, request ids or key fragments that must not
    reach the client.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py. Unlike
    /api/nlp/parse (a public query every RouteBuilder user's search box
    calls), this is NOT exempted: it's part of the admin-only Cable Import
    tool and spends real LLM budget on every call, the same profile as the
    Outage Parser's own LLM-calling endpoint, which is admin-gated too.
    """
    try:
        provider = get_provider()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    name = request.cable_name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="cable_name cannot be blank")

    try:
        return research_cable(provider, name)
    except Exception:
        log.exception("Cable research failed for %r", name)
        raise HTTPException(
            status_code=500,
            detail="Could not research this cable. Try again, or fill the fields in manually.",
        )
