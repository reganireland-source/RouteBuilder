from fastapi import APIRouter
from ..data_loader import load_capacity
from ..models import SegmentCapacity

router = APIRouter()


@router.get("/capacity", response_model=list[SegmentCapacity])
def get_capacity():
    return load_capacity()
