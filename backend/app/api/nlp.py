from fastapi import APIRouter, HTTPException
from ..models import NlpParseRequest, NlpParseResponse
from ..data_loader import load_nodes, load_segments
from ..nlp.provider import get_provider
from ..nlp.parser import parse_route_request

router = APIRouter(prefix="/nlp", tags=["nlp"])


@router.post("/parse", response_model=NlpParseResponse)
def nlp_parse(request: NlpParseRequest):
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
