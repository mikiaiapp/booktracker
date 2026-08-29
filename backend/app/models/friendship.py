from sqlalchemy import Column, String, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.models.base import Base
import uuid


class Friendship(Base):
    __tablename__ = "friendships"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, nullable=False, index=True)      # Remitente de la solicitud
    friend_id = Column(String, nullable=False, index=True)    # Destinatario de la solicitud
    status = Column(String, default="pending")                # pending | accepted
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint('user_id', 'friend_id', name='_user_friend_uc'),
    )
