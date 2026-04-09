"""
Database architecture:
- Global DB: users, auth sessions (global.db)
- Per-user DB: books, chapters, characters, analysis ({user_id}.db)
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, String, Integer, Boolean, DateTime, Text, Float, JSON
from sqlalchemy import func
from typing import AsyncGenerator
import os

from app.core.config import settings


class Base(DeclarativeBase):
    pass


# ── Global DB engine ──────────────────────────────────────────────────────────
def get_global_engine():
    db_path = settings.GLOBAL_DB_PATH
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    return create_async_engine(
        f"sqlite+aiosqlite:///{db_path}",
        echo=False,
        connect_args={"check_same_thread": False},
    )


_global_engine = None
_global_session_factory = None


async def init_global_db():
    global _global_engine, _global_session_factory
    _global_engine = get_global_engine()
    _global_session_factory = async_sessionmaker(_global_engine, expire_on_commit=False)
    async with _global_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def get_global_db() -> AsyncGenerator[AsyncSession, None]:
    async with _global_session_factory() as session:
        yield session


# ── Per-user DB ───────────────────────────────────────────────────────────────
_user_engines: dict = {}
_user_sessions: dict = {}


def get_user_db_path(user_id: str) -> str:
    return os.path.join(settings.DATABASE_DIR, f"user_{user_id}.db")


async def get_user_engine(user_id: str):
    if user_id not in _user_engines:
        db_path = get_user_db_path(user_id)
        engine = create_async_engine(
            f"sqlite+aiosqlite:///{db_path}",
            echo=False,
            connect_args={"check_same_thread": False},
        )
        _user_engines[user_id] = engine
        _user_sessions[user_id] = async_sessionmaker(engine, expire_on_commit=False)
        # Create tables
        from app.models.book import BookBase
        async with engine.begin() as conn:
            await conn.run_sync(BookBase.metadata.create_all)
            try:
                # Intento de migración manual para SQLite
                from sqlalchemy import text
                await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN model TEXT"))
            except:
                pass # Probablemente ya existe
    return _user_engines[user_id]


async def get_user_db(user_id: str) -> AsyncGenerator[AsyncSession, None]:
    await get_user_engine(user_id)
    async with _user_sessions[user_id]() as session:
        yield session
