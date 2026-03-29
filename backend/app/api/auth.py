from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel, EmailStr
from datetime import datetime, timedelta
from typing import Optional
import pyotp
import qrcode
import io
import base64

from app.core.database import get_global_db
from app.core.config import settings
from app.models.user import User
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
    tfa_method: str = "totp"  # totp | email | none


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


# ── Register ──────────────────────────────────────────────────────────────────
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
        is_verified=True,
    )

    if req.tfa_method == "totp":
        user.totp_secret = pyotp.random_base32()
        user.totp_enabled = True
    elif req.tfa_method == "email":
        user.email_otp_enabled = True

    db.add(user)
    await db.commit()
    await db.refresh(user)

    response = {"id": user.id, "email": user.email, "username": user.username}

    if req.tfa_method == "totp":
        totp = pyotp.TOTP(user.totp_secret)
        uri = totp.provisioning_uri(user.email, issuer_name="BookTracker")
        qr = qrcode.make(uri)
        buf = io.BytesIO()
        qr.save(buf, format="PNG")
        response["totp_qr"] = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()
        response["totp_secret"] = user.totp_secret

    return response


# ── Login Step 1 ──────────────────────────────────────────────────────────────
@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_global_db)):
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(401, "Invalid credentials")

    if not user.is_active:
        raise HTTPException(403, "Account disabled")

    # If 2FA enabled, return temp token
    if user.totp_enabled or user.email_otp_enabled:
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
    user.last_login = datetime.utcnow()
    await db.commit()
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
        if not totp.verify(req.code, valid_window=1):
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
async def me(current_user: User = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "email": current_user.email,
        "username": current_user.username,
        "totp_enabled": current_user.totp_enabled,
        "email_otp_enabled": current_user.email_otp_enabled,
        "avatar_color": current_user.avatar_color,
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
    if not verify_password(req.current_password, current_user.hashed_password):
        raise HTTPException(400, "Contraseña actual incorrecta")
    if len(req.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    current_user.hashed_password = get_password_hash(req.new_password)
    await db.commit()
    return {"message": "Contraseña actualizada"}


# ── Configurar/desactivar 2FA ──────────────────────────────────
@router.post("/setup-2fa")
async def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    """Genera nuevo secret TOTP y devuelve QR para escanear."""
    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    current_user.totp_enabled = False  # No activar hasta verificar
    await db.commit()
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(
        name=current_user.email,
        issuer_name="BookTracker"
    )
    # Generar QR en base64
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_b64 = base64.b64encode(buf.getvalue()).decode()
    return {"secret": secret, "qr": f"data:image/png;base64,{qr_b64}"}


@router.post("/verify-setup-2fa")
async def verify_setup_2fa(
    req: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    """Verifica el código TOTP y activa el 2FA."""
    code = req.get("code", "")
    if not current_user.totp_secret:
        raise HTTPException(400, "Primero genera el QR")
    totp = pyotp.TOTP(current_user.totp_secret)
    if not totp.verify(code, valid_window=1):
        raise HTTPException(400, "Código incorrecto")
    current_user.totp_enabled = True
    await db.commit()
    return {"message": "2FA activado correctamente"}


@router.post("/disable-2fa")
async def disable_2fa(
    req: dict,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_global_db),
):
    """Desactiva el 2FA tras verificar contraseña."""
    if not verify_password(req.get("password", ""), current_user.hashed_password):
        raise HTTPException(400, "Contraseña incorrecta")
    current_user.totp_enabled = False
    current_user.totp_secret = None
    await db.commit()
    return {"message": "2FA desactivado"}


# ── Recuperar contraseña ───────────────────────────────────────
class ForgotPasswordRequest(BaseModel):
    email: EmailStr

@router.post("/forgot-password")
async def forgot_password(
    req: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_global_db),
):
    """Envía OTP por email para resetear contraseña."""
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if user:
        otp = generate_otp()
        user.email_otp = otp
        user.email_otp_expires = datetime.utcnow() + timedelta(minutes=15)
        await db.commit()
        # Intentar enviar email
        email_sent = False
        try:
            await send_otp_email(req.email, otp)
            email_sent = True
        except Exception as e:
            print(f"[OTP] Email no enviado: {e}")
        # Si no hay SMTP, devolver el código directamente
        if not email_sent:
            return {
                "message": "Email no configurado. Usa este código directamente.",
                "code": otp,
                "dev_mode": True
            }
    return {"message": "Si el email existe, recibirás un código de recuperación"}


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str
    new_password: str

@router.post("/reset-password")
async def reset_password(
    req: ResetPasswordRequest,
    db: AsyncSession = Depends(get_global_db),
):
    """Resetea la contraseña con el código OTP recibido por email."""
    result = await db.execute(select(User).where(User.email == req.email))
    user = result.scalar_one_or_none()
    if not user or not user.email_otp:
        raise HTTPException(400, "Código inválido o expirado")
    if user.email_otp != req.code:
        raise HTTPException(400, "Código incorrecto")
    if datetime.utcnow() > user.email_otp_expires:
        raise HTTPException(400, "El código ha expirado. Solicita uno nuevo.")
    if len(req.new_password) < 8:
        raise HTTPException(400, "La contraseña debe tener al menos 8 caracteres")
    user.hashed_password = get_password_hash(req.new_password)
    user.email_otp = None
    user.email_otp_expires = None
    await db.commit()
    return {"message": "Contraseña actualizada correctamente"}
