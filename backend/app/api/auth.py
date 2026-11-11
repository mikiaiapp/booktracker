from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from typing import Optional
import secrets
import pyotp
import qrcode
import io
import base64

from app.core.database import get_global_db
from app.core.config import settings
from app.models.user import User
from app.core.mailer import send_email
from app.core.security import (
    verify_password, get_password_hash,
    create_access_token, get_current_user,
    generate_otp, send_otp_email
)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────
class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class TFAVerifyRequest(BaseModel):
    temp_token: str
    code: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    requires_2fa: bool = False
    temp_token: Optional[str] = None
    tfa_method: Optional[str] = None


# ── Register ──────────────────────────────────
def _enlace(accion: str, token: str) -> str:
    return f"{settings.APP_URL.rstrip('/')}?action={accion}&token={token}"


async def _enviar_verificacion(user: User):
    enlace = _enlace("verify", user.verification_token)
    await send_email(
        user.email,
        "Verifica tu cuenta en BookTracker",
        f"Haz click en este enlace para activar tu cuenta: {enlace}",
        f'<p>Bienvenido a BookTracker.</p><p>Para activar tu cuenta, haz clic aquí:</p><a href="{enlace}">{enlace}</a>',
    )


@router.post("/register", status_code=201)
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_global_db)):
    # Check existing
    result = await db.execute(select(User).where(User.email == req.email))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Email already registered")

    result = await db.execute(select(User).where(User.username == req.username))
    if result.scalar_one_or_none():
        raise HTTPException(400, "Username already taken")

    user = User(
        email=req.email,
        username=req.username,
        hashed_password=get_password_hash(req.password),
        is_verified=False,
        verification_token=secrets.token_hex(32),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    await _enviar_verificacion(user)
    return {"message": "Usuario creado. Revisa tu email para activar la cuenta."}


class VerifyRequest(BaseModel):
    token: str


@router.post("/verify")
async def verify_email(req: VerifyRequest, db: AsyncSession = Depends(get_global_db)):
    if not req.token:
        raise HTTPException(400, "Token requerido")
    result = await db.execute(select(User).where(User.verification_token == req.token))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(400, "Token inválido o expirado")
    user.is_verified = True
    await db.commit()
    return {"success": True}


class ResendVerificationRequest(BaseModel):
    email: EmailStr


@router.post("/resend-verification")
async def resend_verification(req: ResendVerificationRequest, db: AsyncSession = Depends(get_global_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(400, "Usuario no encontrado")
    if user.is_verified:
        raise HTTPException(400, "El usuario ya está verificado")
    user.verification_token = secrets.token_hex(32)
    await db.commit()
    await _enviar_verificacion(user)
    return {"success": True}


# ── Login Step 1 ──────────────────────────────────────────────────────────────
@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_global_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(401, "Invalid credentials")

    if not user.is_active:
        raise HTTPException(403, "Account disabled")

    if not user.is_verified:
        raise HTTPException(403, "Cuenta no verificada. Revisa tu email.")

    # If 2FA enabled, return temp token
    if (user.totp_enabled or user.email_otp_enabled):
        temp_token = create_access_token(
            {"sub": user.id, "temp": True}, expires_delta=timedelta(minutes=10)
        )

        if user.email_otp_enabled:
            otp = generate_otp()
            user.pending_otp = otp
            user.pending_otp_expires = datetime.utcnow() + timedelta(minutes=10)
            await db.commit()
            await send_otp_email(user.email, otp)

        return TokenResponse(
            access_token="",
            requires_2fa=True,
            temp_token=temp_token,
            tfa_method="totp" if user.totp_enabled else "email",
        )

    # No 2FA: issue full token
    try:
        user.last_login = datetime.utcnow()
        await db.commit()
    except:
        await db.rollback()

    token = create_access_token({"sub": user.id})
    return TokenResponse(access_token=token)


# ── Login Step 2: Verify 2FA ──────────────────────────────────────────────────
@router.post("/verify-2fa")
async def verify_2fa(req: TFAVerifyRequest, db: AsyncSession = Depends(get_global_db)):
    from app.core.security import decode_temp_token
    user_id = decode_temp_token(req.temp_token)
    if not user_id:
        raise HTTPException(401, "Invalid or expired session")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    # Verify code
    if user.totp_enabled:
        totp = pyotp.TOTP(user.totp_secret)
        # Aumentamos valid_window a 3 (desfase permitido de ~90 seg) por si hay desincronización horaria en Docker
        if not totp.verify(req.code, valid_window=3):
            raise HTTPException(401, "Invalid TOTP code")
    elif user.email_otp_enabled:
        if not user.pending_otp or user.pending_otp != req.code:
            raise HTTPException(401, "Invalid OTP code")
        if datetime.utcnow() > user.pending_otp_expires:
            raise HTTPException(401, "OTP expired")
        user.pending_otp = None
        user.pending_otp_expires = None

    user.last_login = datetime.utcnow()
    await db.commit()
    token = create_access_token({"sub": user.id})
    return TokenResponse(access_token=token)


# ── Me ────────────────────────────────────────────────────────────────────────
@router.get("/me")
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    # Autopoblar desde env si están vacíos (primera vez) con protección extra
    changed = False
    try:
        if (not current_user.gemini_api_key or current_user.gemini_api_key == "") and settings.GEMINI_API_KEY:
            current_user.gemini_api_key = settings.GEMINI_API_KEY
            changed = True
        if (not current_user.openai_api_key or current_user.openai_api_key == "") and settings.OPENAI_API_KEY:
            current_user.openai_api_key = settings.OPENAI_API_KEY
            changed = True
        if (not current_user.anthropic_api_key or current_user.anthropic_api_key == "") and settings.ANTHROPIC_API_KEY:
            current_user.anthropic_api_key = settings.ANTHROPIC_API_KEY
            changed = True
            
        if changed:
            await db.commit()
            await db.refresh(current_user)
    except Exception as e:
        print(f"[AUTH] Error en auto-migración de claves: {e}")
        await db.rollback()

    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
        "totp_enabled": current_user.totp_enabled,
        "email_otp_enabled": current_user.email_otp_enabled,
        "avatar_color": current_user.avatar_color,
        "tts_voice": getattr(current_user, 'tts_voice', 'alloy') or 'alloy',
        "tts_speed": getattr(current_user, 'tts_speed', '1.0') or '1.0',
        "api_settings": {
            "gemini_api_key": current_user.gemini_api_key,
            "openai_api_key": current_user.openai_api_key,
            "anthropic_api_key": current_user.anthropic_api_key,
            "preferred_model": current_user.preferred_model
        }
    }


# ── Cambiar contraseña ─────────────────────────────────────────
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

@router.post("/change-password")
async def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")
    if not verify_password(req.current_password, user.hashed_password):
        raise HTTPException(400, "Contraseña actual incorrecta")
    if len(req.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    user.hashed_password = get_password_hash(req.new_password)
    await db.commit()
    return {"message": "Contraseña actualizada"}


# ── Configurar/desactivar 2FA ──────────────────────────────────
@router.post("/setup-2fa")
async def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    """Genera nuevo secret TOTP y devuelve QR para escanear."""
    # Obtener usuario desde ESTA sesión de BD para poder modificarlo
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")
    secret = pyotp.random_base32()
    user.totp_secret = secret
    user.totp_enabled = False
    await db.commit()
    await db.refresh(user)
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(
        name=user.email,
        issuer_name="BookTracker"
    )
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return {"secret": secret, "qr": f"data:image/png;base64,{qr_b64}"}


class VerifyTOTPRequest(BaseModel):
    code: str

@router.post("/verify-setup-2fa")
async def verify_setup_2fa(
    req: VerifyTOTPRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    """Verifica el código TOTP y activa el 2FA."""
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user or not user.totp_secret:
        raise HTTPException(400, "Primero genera el QR")
    totp = pyotp.TOTP(user.totp_secret)
    if not totp.verify(req.code, valid_window=1):
        raise HTTPException(400, "Código incorrecto")
    user.totp_enabled = True
    await db.commit()
    return {"message": "2FA activado correctamente"}


class DisableTFARequest(BaseModel):
    password: str

@router.post("/disable-2fa")
async def disable_2fa(
    req: DisableTFARequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    """Desactiva el 2FA tras verificar contraseña."""
    result = await db.execute(select(User).where(User.id == current_user.id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "Usuario no encontrado")
    if not verify_password(req.password, user.hashed_password):
        raise HTTPException(400, "Contraseña incorrecta")
    user.totp_enabled = False
    user.totp_secret = None
    await db.commit()
    return {"message": "2FA desactivado"}


# ── Recuperar contraseña ─────────────────────────────
class ForgotPasswordRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
async def forgot_password(
    req: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_global_db),
):
    """Envía por correo un enlace (válido 1 hora) para restablecer la contraseña. Responde siempre igual: no revela si la cuenta existe."""
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user:
        user.reset_token = secrets.token_hex(32)
        user.reset_expires = datetime.utcnow() + timedelta(hours=1)
        await db.commit()
        enlace = _enlace("reset", user.reset_token)
        await send_email(
            user.email,
            "Recuperar contraseña de BookTracker",
            f"Haz click en este enlace para restablecer tu contraseña (válido 1 hora): {enlace}",
            f'<p>Has solicitado restablecer tu contraseña de BookTracker.</p><p>Haz clic aquí (válido 1 hora):</p><a href="{enlace}">{enlace}</a>'
            f'<p>Si no has sido tú, ignora este correo.</p>',
        )
    return {"success": True}


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str


@router.post("/reset-password")
async def reset_password(
    req: ResetPasswordRequest,
    db: AsyncSession = Depends(get_global_db),
):
    """Restablece la contraseña con el token recibido por correo."""
    if not req.token:
        raise HTTPException(400, "Enlace inválido o expirado")
    result = await db.execute(select(User).where(User.reset_token == req.token))
    user = result.scalar_one_or_none()
    if not user or not user.reset_expires or user.reset_expires < datetime.utcnow():
        raise HTTPException(400, "Enlace inválido o expirado")
    if len(req.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    user.hashed_password = get_password_hash(req.new_password)
    user.reset_token = None
    user.reset_expires = None
    await db.commit()
    return {"message": "Contraseña actualizada correctamente"}
