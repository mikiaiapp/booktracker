"""Claves de acceso (passkeys / WebAuthn): Face ID, huella o PIN del dispositivo sustituyen a usuario, contraseña y código del autenticador.
Contrato del estándar de usuarios (docs/usuarios/passkeys.md): retos de un solo uso y 5 minutos, credenciales descubribles,
verificación de usuario obligatoria, comprobación de origen, dominio, firma y contador."""
import hashlib
import json
import secrets
import time
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn import (
    generate_authentication_options, generate_registration_options, options_to_json,
    verify_authentication_response, verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria, PublicKeyCredentialDescriptor, ResidentKeyRequirement, UserVerificationRequirement,
)

from app.core.config import settings
from app.core.database import get_global_db
from app.core.security import create_access_token, get_current_user
from app.models.passkey import Passkey
from app.models.user import User

router = APIRouter()

_url = urlparse(settings.APP_URL)
RP_ID = settings.WEBAUTHN_RP_ID or _url.hostname or "localhost"
RP_ORIGIN = settings.WEBAUTHN_ORIGIN or f"{_url.scheme}://{_url.netloc}"
RP_NAME = "BookTracker"

_retos: dict = {}  # clave -> (challenge bytes, expira); solo en memoria, un solo uso, 5 minutos


def _guardar_reto(clave: str, challenge: bytes):
    ahora = time.time()
    for k in [k for k, v in _retos.items() if v[1] < ahora]:
        _retos.pop(k, None)
    _retos[clave] = (challenge, ahora + 300)


def _tomar_reto(clave: str) -> Optional[bytes]:
    r = _retos.pop(clave, None)
    return r[0] if r and r[1] > time.time() else None


class RegisterVerify(BaseModel):
    name: Optional[str] = None
    response: dict


class LoginVerify(BaseModel):
    challengeId: str
    response: dict


@router.get("")
async def listar(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    res = await db.execute(select(Passkey).where(Passkey.user_id == user.id).order_by(Passkey.created_at))
    return {"passkeys": [
        {"id": p.credential_id, "name": p.name, "createdAt": p.created_at.isoformat() if p.created_at else None,
         "lastUsed": p.last_used.isoformat() if p.last_used else None}
        for p in res.scalars()
    ]}


@router.post("/register/options")
async def registro_opciones(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    res = await db.execute(select(Passkey).where(Passkey.user_id == user.id))
    opts = generate_registration_options(
        rp_id=RP_ID, rp_name=RP_NAME,
        user_id=hashlib.sha256(("booktracker:" + user.id).encode()).digest(),
        user_name=user.email, user_display_name=user.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED, user_verification=UserVerificationRequirement.REQUIRED),
        exclude_credentials=[PublicKeyCredentialDescriptor(id=base64url_to_bytes(p.credential_id)) for p in res.scalars()],
    )
    _guardar_reto("reg:" + user.id, opts.challenge)
    return json.loads(options_to_json(opts))


@router.post("/register/verify")
async def registro_verificar(req: RegisterVerify, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    challenge = _tomar_reto("reg:" + user.id)
    if not challenge:
        raise HTTPException(400, "La operación ha caducado. Inténtalo de nuevo.")
    try:
        v = verify_registration_response(
            credential=req.response, expected_challenge=challenge, expected_rp_id=RP_ID,
            expected_origin=RP_ORIGIN, require_user_verification=True)
    except Exception:
        raise HTTPException(400, "No se pudo registrar la clave de acceso")
    cid = bytes_to_base64url(v.credential_id)
    if (await db.execute(select(Passkey).where(Passkey.credential_id == cid))).scalar_one_or_none():
        raise HTTPException(409, "Esa clave ya está registrada")
    transports = (req.response.get("response") or {}).get("transports") or []
    db.add(Passkey(
        user_id=user.id, credential_id=cid, public_key=bytes_to_base64url(v.credential_public_key),
        sign_count=v.sign_count, transports=json.dumps(transports), device_type=str(v.credential_device_type.value),
        backed_up=bool(v.credential_backed_up),
        name=(req.name or "").replace("<", "").replace(">", "").strip()[:40] or "Mi dispositivo"))
    await db.commit()
    return {"success": True}


@router.delete("/{credential_id}")
async def eliminar(credential_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    p = (await db.execute(select(Passkey).where(Passkey.credential_id == credential_id, Passkey.user_id == user.id))).scalar_one_or_none()
    if not p:
        raise HTTPException(404, "Clave no encontrada")
    await db.delete(p)
    await db.commit()
    return {"success": True}


# Acceso sin escribir nada (credenciales «descubribles»): el navegador ofrece las claves de este sitio
@router.post("/login/options")
async def acceso_opciones():
    opts = generate_authentication_options(rp_id=RP_ID, user_verification=UserVerificationRequirement.REQUIRED)
    challenge_id = secrets.token_hex(16)
    _guardar_reto("login:" + challenge_id, opts.challenge)
    return {"options": json.loads(options_to_json(opts)), "challengeId": challenge_id}


@router.post("/login/verify")
async def acceso_verificar(req: LoginVerify, db: AsyncSession = Depends(get_global_db)):
    challenge = _tomar_reto("login:" + req.challengeId)
    cid = req.response.get("id")
    if not challenge or not cid:
        raise HTTPException(401, "La operación ha caducado. Inténtalo de nuevo.")
    p = (await db.execute(select(Passkey).where(Passkey.credential_id == cid))).scalar_one_or_none()
    if not p:
        raise HTTPException(401, "Clave de acceso no reconocida")
    try:
        v = verify_authentication_response(
            credential=req.response, expected_challenge=challenge, expected_rp_id=RP_ID, expected_origin=RP_ORIGIN,
            credential_public_key=base64url_to_bytes(p.public_key), credential_current_sign_count=p.sign_count or 0,
            require_user_verification=True)
    except Exception:
        raise HTTPException(401, "No se pudo verificar la clave de acceso")
    user = (await db.execute(select(User).where(User.id == p.user_id))).scalar_one_or_none()
    if not user:
        raise HTTPException(401, "Clave de acceso no reconocida")
    if not user.is_active:
        raise HTTPException(403, "Account disabled")
    if not user.is_verified:
        raise HTTPException(403, "Cuenta no verificada. Revisa tu email.")
    p.sign_count = v.new_sign_count
    p.last_used = datetime.utcnow()
    user.last_login = datetime.utcnow()
    await db.commit()
    return {"access_token": create_access_token({"sub": user.id}), "token_type": "bearer", "username": user.email}
