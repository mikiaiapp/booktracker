import sqlite3
import os
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy import text, select
from app.core.config import settings

# Base para SQL Alchemy
Base = declarative_base()

# Base de datos global (Usuarios, Autenticación, etc)
GLOBAL_DB_PATH = os.path.join(settings.DB_DIR, "global.db")
global_engine = create_async_engine(f"sqlite+aiosqlite:///{GLOBAL_DB_PATH}")
GlobalSessionLocal = sessionmaker(global_engine, class_=AsyncSession, expire_on_commit=False)

async def init_global_db():
    from app.models.user import User
    async with global_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Migración manual para nuevas columnas de API si no existen
    async with GlobalSessionLocal() as session:
        try:
            # Crear tabla si no existe (vía metadata)
            # Y luego intentar añadir columnas una a una
            cols = [
                ("gemini_api_key", "TEXT"),
                ("openai_api_key", "TEXT"),
                ("anthropic_api_key", "TEXT"),
                ("preferred_model", "VARCHAR")
            ]
            for col_name, col_type in cols:
                try:
                    await session.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
                    await session.commit()
                    print(f"[DB] Columna {col_name} añadida a users")
                except Exception:
                    # Probablemente ya existe
                    pass
        except Exception as e:
            print(f"[DB] Error en migración de usuarios: {e}")

async def get_global_db():
    async with GlobalSessionLocal() as session:
        yield session

# Base de datos por usuario (inquilinos / tenants)
# Cada usuario tiene su propio archivo .db para aislamiento total de datos literarios
def get_user_db_path(user_id: str):
    return os.path.join(settings.DB_DIR, f"user_{user_id}.db")

async def get_user_db(user_id: str):
    db_path = get_user_db_path(user_id)
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}")
    
    # Importar modelos para asegurar que se crean las tablas en el nuevo tenant
    from app.models.book import BookBase
    async with engine.begin() as conn:
        await conn.run_sync(BookBase.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()
            await engine.dispose()
