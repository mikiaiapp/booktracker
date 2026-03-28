from datetime import datetime, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
import random
import string
import aiosmtplib
from email.mime.text import MIMEText

from app.core.config import settings

# bcrypt 4.x eliminó __about__; este filtro suprime el warning de passlib
import warnings
warnings.filterwarnings("ignore", ".*error reading bcrypt version.*")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# bcrypt limita contraseñas a 72 bytes — truncamos antes de hashear
def _truncate(password: str) -> str:
    return password.encode("utf-8")[:72].decode("utf-8", errors="ignore")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(_truncate(plain), hashed)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(_truncate(password))


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_temp_token(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if not payload.get("temp"):
            return None
        return payload.get("sub")
    except JWTError:
        return None


async def get_current_user(
    token: str = Depends(oauth2_scheme),
):
    from app.models.user import User
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None or payload.get("temp"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    from app.core.database import _global_session_factory
    async with _global_session_factory() as db:
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

    if user is None:
        raise credentials_exception
    return user


def generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


async def send_otp_email(email: str, otp: str):
    if not settings.SMTP_HOST:
        print(f"[DEV] OTP para {email}: {otp}")
        return

    msg = MIMEText(f"""
    <h2>BookTracker - Código de verificación</h2>
    <p>Tu código de acceso es:</p>
    <h1 style="letter-spacing: 8px; color: #6366f1;">{otp}</h1>
    <p>Válido por 10 minutos.</p>
    """, "html")
    msg["Subject"] = "BookTracker - Código 2FA"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = email

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            start_tls=True,
        )
    except Exception as e:
        print(f"Email error: {e}")
