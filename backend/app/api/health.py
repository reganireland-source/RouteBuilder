from fastapi import APIRouter
from ..data_loader import load_nodes, load_segments, load_systems
from ..data_checks import run_all_checks, checks_summary

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health_check():
    nodes    = load_nodes()
    segments = load_segments()
    systems  = load_systems()
    return {
        "status":   "ok",
        "nodes":    len(nodes),
        "segments": len(segments),
        "systems":  len(systems),
    }


@router.get("/checks")
def integrity_checks():
    return checks_summary(run_all_checks())
