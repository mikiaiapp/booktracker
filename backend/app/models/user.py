from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.sql import func
from app.models.base import Base
import uuid


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String, unique=True, nullable=False, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    is_verified = Column(Boolean, default=False)

    # 2FA
    totp_secret = Column(String, nullable=True)
    totp_enabled = Column(Boolean, default=False)
    email_otp_enabled = Column(Boolean, default=False)
    pending_otp = Column(String, nullable=True)
    pending_otp_expires = Column(DateTime, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    last_login = Column(DateTime, nullable=True)
    avatar_color = Column(String, default="#6366f1")

    # API Keys & Settings
    gemini_api_key = Column(Text, nullable=True)
    openai_api_key = Column(Text, nullable=True)
    anthropic_api_key = Column(Text, nullable=True)
    groq_api_key = Column(Text, nullable=True)
    preferred_model = Column(String, nullable=True)
