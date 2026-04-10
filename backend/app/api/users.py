from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.core.security import get_current_user
from app.core.database import get_global_db
from app.models.user import User

router = APIRouter()


class UserSettingsUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    preferred_model: Optional[str] = None

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
        "preferred_model": current_user.preferred_model,
        # No devolvemos las claves completas por seguridad
        "has_gemini": bool(current_user.gemini_api_key),
        "has_openai": bool(current_user.openai_api_key),
        "has_anthropic": bool(current_user.anthropic_api_key),
    }

@router.get("/settings")
async def get_settings(current_user: User = Depends(get_current_user)):
    def mask(k): return f"{k[:4]}...{k[-4:]}" if k and len(k) > 10 else None
    return {
        "gemini_api_key": mask(current_user.gemini_api_key),
        "openai_api_key": mask(current_user.openai_api_key),
        "anthropic_api_key": mask(current_user.anthropic_api_key),
        "preferred_model": current_user.preferred_model
    }

@router.put("/settings")
async def update_settings(
    settings_data: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db)
):
    if settings_data.gemini_api_key is not None:
        current_user.gemini_api_key = settings_data.gemini_api_key
    if settings_data.openai_api_key is not None:
        current_user.openai_api_key = settings_data.openai_api_key
    if settings_data.anthropic_api_key is not None:
        current_user.anthropic_api_key = settings_data.anthropic_api_key
    if settings_data.preferred_model is not None:
        current_user.preferred_model = settings_data.preferred_model
    
    await db.merge(current_user)
    await db.commit()
    return {"status": "success"}
