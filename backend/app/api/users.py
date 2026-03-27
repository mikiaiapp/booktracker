from fastapi import APIRouter, Depends
from app.core.security import get_current_user
from app.models.user import User

router = APIRouter()


@router.get("/profile")
async def get_profile(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
        "totp_enabled": current_user.totp_enabled,
        "email_otp_enabled": current_user.email_otp_enabled,
        "avatar_color": current_user.avatar_color,
        "created_at": current_user.created_at,
    }
