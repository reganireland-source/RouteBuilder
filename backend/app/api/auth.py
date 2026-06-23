import os
from fastapi import APIRouter, HTTPException
from fastapi import Request

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/verify")
async def verify_admin(request: Request):
    """Verify an admin token. Returns 200 if valid or if no key is configured (open/dev mode)."""
    admin_key = os.getenv("ADMIN_KEY", "")
    if not admin_key:
        return {"status": "ok", "role": "admin", "mode": "open"}
    token = request.headers.get("x-admin-token", "")
    if token == admin_key:
        return {"status": "ok", "role": "admin", "mode": "keyed"}
    raise HTTPException(status_code=403, detail="Invalid admin token")


@router.get("/status")
def auth_status():
    """Returns whether the backend requires an admin token for write operations."""
    return {"auth_required": bool(os.getenv("ADMIN_KEY", ""))}
