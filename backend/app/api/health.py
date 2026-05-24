import os
from fastapi import APIRouter
from ..data_loader import load_nodes, load_segments, load_systems
from ..data_checks import run_all_checks, checks_summary

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health_check():
    from ..db import DATABASE_URL
    nodes    = load_nodes()
    segments = load_segments()
    systems  = load_systems()
    return {
        "status":   "ok",
        "nodes":    len(nodes),
        "segments": len(segments),
        "systems":  len(systems),
        "storage":  "postgres" if DATABASE_URL else "json",
    }


@router.get("/checks")
def integrity_checks():
    return checks_summary(run_all_checks())


@router.get("/nlp")
def nlp_status():
    if os.getenv("NLP_ENABLED", "").lower() != "true":
        return {"status": "disabled", "provider": None, "detail": "NLP disabled"}
    if os.getenv("ANTHROPIC_API_KEY"):
        return {"status": "ok", "provider": "claude", "detail": "Claude (Haiku)"}
    if os.getenv("AZURE_OPENAI_ENDPOINT"):
        return {"status": "ok", "provider": "azure", "detail": "Azure OpenAI"}
    if os.getenv("OPENAI_API_KEY"):
        return {"status": "ok", "provider": "openai", "detail": "GPT-4o-mini"}
    return {"status": "error", "provider": None, "detail": "No API key set"}
