from fastapi import APIRouter
from ..data_loader import load_nodes, load_segments, load_systems

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
