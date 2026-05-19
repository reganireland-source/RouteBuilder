from fastapi import APIRouter
from ..models import CableSystem
from ..data_loader import load_systems

router = APIRouter(prefix="/systems", tags=["systems"])


@router.get("", response_model=list[CableSystem])
def get_systems():
    return load_systems()
