from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional
from app.core.security import get_current_user
from app.core.database import get_global_db
from app.models.user import User
from app.services.ai_analyzer import test_api_key, _get_dynamic_hierarchy

router = APIRouter()

class UserSettingsUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    preferred_model: Optional[str] = None

class TestAPIRequest(BaseModel):
    provider: str
    model: Optional[str] = None
    api_key: Optional[str] = None

@router.get("/profile")
async def get_profile(
    background_tasks: BackgroundTasks, 
    current_user: User = Depends(get_current_user)
):
    # Al entrar en la app (se llama a /profile), disparamos un refresco de modelos en 2º plano
    # Solo si tiene alguna API Key configurada
    keys = {
        "gemini": current_user.gemini_api_key,
        "openai": current_user.openai_api_key,
        "groq": getattr(current_user, "groq_api_key", None),
        "preferred_model": current_user.preferred_model
    }
    if any([keys["gemini"], keys["openai"], keys["groq"]]):
        # No bloqueamos el login, lo hacemos en background
        background_tasks.add_task(_get_dynamic_hierarchy, keys, force=True)

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
        "has_groq": bool(getattr(current_user, 'groq_api_key', None)),
    }

@router.get("/settings")
async def get_settings(current_user: User = Depends(get_current_user)):
    def mask(k): return f"{k[:4]}...{k[-4:]}" if k and len(k) > 10 else None
    return {
        "gemini_api_key": mask(current_user.gemini_api_key),
        "openai_api_key": mask(current_user.openai_api_key),
        "groq_api_key": mask(getattr(current_user, 'groq_api_key', None)),
        "preferred_model": current_user.preferred_model,
        "has_gemini": bool(current_user.gemini_api_key),
        "has_openai": bool(current_user.openai_api_key),
        "has_groq": bool(getattr(current_user, 'groq_api_key', None)),
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
    if settings_data.groq_api_key is not None:
        # Guardamos de forma segura incluso si la columna aún no existe en la DB (graceful)
        try:
            current_user.groq_api_key = settings_data.groq_api_key
        except Exception:
            pass
    if settings_data.preferred_model is not None:
        current_user.preferred_model = settings_data.preferred_model
    
    await db.merge(current_user)
    await db.commit()
    return {"status": "success"}

@router.post("/test-api")
async def test_api_endpoint(
    data: TestAPIRequest,
    current_user: User = Depends(get_current_user)
):
    key_to_test = data.api_key
    
    # Si no nos pasan la llave (enmascarada), usamos la de DB
    if not key_to_test or "..." in key_to_test:
        if data.provider == "gemini":
            key_to_test = current_user.gemini_api_key
        elif data.provider == "openai":
            key_to_test = current_user.openai_api_key
        elif data.provider == "groq":
            key_to_test = getattr(current_user, 'groq_api_key', None)
    
    if not key_to_test:
        raise HTTPException(status_code=400, detail="No hay clave de API para probar")

    # Si no se especifica modelo, usamos el descubrimiento dinámico
    model = data.model
    if not model:
        # Intentamos descubrir el mejor modelo disponible
        keys = {"gemini": "", "openai": "", "groq": ""}
        keys[data.provider] = key_to_test
        hierarchy = await _get_dynamic_hierarchy(keys, force=True)
        
        if hierarchy:
            # El primero de la lista es el de mayor score
            model = hierarchy[0][1]
        else:
            # Fallback seguro por si falla el descubrimiento
            if data.provider == "gemini": model = "gemini-1.5-flash"
            elif data.provider == "groq": model = "llama-3.3-70b-versatile"
            elif data.provider == "openai": model = "gpt-4o-mini"
    
    try:
        success = await test_api_key(data.provider, key_to_test, model)
        if success:
            return {"status": "success", "message": f"Conexión con {data.provider.title()} establecida correctamente ✓"}
        else:
            return {"status": "error", "message": "Respuesta inesperada de la IA"}
    except Exception as e:
        error_msg = str(e)
        if "API key not found" in error_msg or "invalid_api_key" in error_msg: 
            error_msg = "Clave de API no válida o revocada"
        if "quota" in error_msg.lower(): 
            error_msg = "Has excedido tu cuota de API"
        raise HTTPException(status_code=400, detail=error_msg)
