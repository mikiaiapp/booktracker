from sqlalchemy import Column, String, Boolean, DateTime, Text, Integer
from sqlalchemy.sql import func
from app.models.base import Base
import uuid


class Passkey(Base):
    """Clave de acceso (passkey / WebAuthn) de un usuario: Face ID, huella o PIN de un dispositivo."""
    __tablename__ = "passkeys"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)
    credential_id = Column(String, unique=True, nullable=False, index=True)  # base64url
    public_key = Column(Text, nullable=False)                                # base64url
    sign_count = Column(Integer, default=0)
    transports = Column(String, nullable=True)                               # JSON
    device_type = Column(String, nullable=True)
    backed_up = Column(Boolean, default=False)
    name = Column(String, default="Mi dispositivo")
    created_at = Column(DateTime, server_default=func.now())
    last_used = Column(DateTime, nullable=True)
