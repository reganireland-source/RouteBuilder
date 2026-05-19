from fastapi import APIRouter
from ..models import CableSegment
from ..data_loader import load_segments

router = APIRouter(prefix="/segments", tags=["segments"])


@router.get("", response_model=list[CableSegment])
def get_segments():
    return load_segments()
