"""
Database architecture:
- Global DB: users, auth sessions (global.db)
- Per-user DB: books, chapters, characters, analysis ({user_id}.db)
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from app.models.base import Base
from app.core.config import settings
from typing import AsyncGenerator
import os


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
    
    # Importar User para registrarlo en metadata
    from app.models.user import User
    
    async with _global_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        
        from sqlalchemy import text
        cols = [
            ("gemini_api_key", "TEXT"),
            ("openai_api_key", "TEXT"), 
            ("anthropic_api_key", "TEXT"),
            ("groq_api_key", "TEXT"),
            ("preferred_model", "TEXT"),
            ("avatar_color", "TEXT"),
            ("totp_enabled", "BOOLEAN DEFAULT 0"),
            ("totp_secret", "TEXT"),
            ("email_otp_enabled", "BOOLEAN DEFAULT 0"),
            ("pending_otp", "TEXT"),
            ("pending_otp_expires", "DATETIME"),
            ("last_login", "DATETIME"),
            ("is_verified", "BOOLEAN DEFAULT 1"),
            ("is_active", "BOOLEAN DEFAULT 1")
        ]
        for col_name, col_type in cols:
            try: 
                await conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
                if col_name == "avatar_color":
                    await conn.execute(text("UPDATE users SET avatar_color = '#6366f1' WHERE avatar_color IS NULL"))
                if col_name == "is_verified":
                    await conn.execute(text("UPDATE users SET is_verified = 1 WHERE is_verified IS NULL"))
                if col_name == "is_active":
                    await conn.execute(text("UPDATE users SET is_active = 1 WHERE is_active IS NULL"))
            except: 
                pass


async def get_global_db() -> AsyncGenerator[AsyncSession, None]:
    global _global_session_factory
    if _global_session_factory is None:
        await init_global_db()
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
            
            # Safe schema migrations using PRAGMA to avoid transaction invalidation
            try:
                from sqlalchemy import text
                
                # Check chat_messages
                res_chat = await conn.execute(text("PRAGMA table_info(chat_messages)"))
                chat_cols = [row[1] for row in res_chat.fetchall()]
                if "model" not in chat_cols:
                    await conn.execute(text("ALTER TABLE chat_messages ADD COLUMN model TEXT"))
                
                # Auto-migrate all missing columns for all tables
                for table_name, table in BookBase.metadata.tables.items():
                    res = await conn.execute(text(f"PRAGMA table_info({table_name})"))
                    existing_cols = {row[1] for row in res.fetchall()}
                    
                    for column in table.columns:
                        if column.name not in existing_cols:
                            # Construct basic ALTER TABLE (no constraints/foreign keys needed for our simple schema updates)
                            ctype = str(column.type.compile(engine.dialect))
                            default_stmt = ""
                            if column.server_default is not None:
                                default_stmt = f" DEFAULT {column.server_default.arg}"
                            elif getattr(column, 'default', None) is not None and getattr(column.default, 'arg', None) is not None:
                                # Very basic default handling for boolean/int
                                if isinstance(column.default.arg, (int, bool, str)) and not callable(column.default.arg):
                                    v = column.default.arg
                                    default_stmt = f" DEFAULT {int(v) if isinstance(v, bool) else repr(v)}"
                            
                            stmt = f"ALTER TABLE {table_name} ADD COLUMN {column.name} {ctype}{default_stmt}"
                            try:
                                await conn.execute(text(stmt))
                            except Exception as alt_e:
                                print(f"Error adding {column.name} to {table_name}: {alt_e}")

            except Exception as e:
                print(f"Error checking schema: {e}")
    return _user_engines[user_id]


async def get_user_db(user_id: str) -> AsyncGenerator[AsyncSession, None]:
    await get_user_engine(user_id)
    async with _user_sessions[user_id]() as session:
        yield session
