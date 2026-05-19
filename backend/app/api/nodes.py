from fastapi import APIRouter
from ..models import Node
from ..data_loader import load_nodes

router = APIRouter(prefix="/nodes", tags=["nodes"])


@router.get("", response_model=list[Node])
def get_nodes():
    return load_nodes()
