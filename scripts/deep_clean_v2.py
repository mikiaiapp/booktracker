import asyncio
import os
import sys

# Añadir el directorio raíz al path para poder importar app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.core.config import settings
from app.core.database import get_global_db, get_user_db
from app.models.user import User
from app.models.book import Book, AnalysisJob
from sqlalchemy import select, update, delete
import redis


def clean_redis_all():
    print("--- Limpiando Redis ---")
    r = redis.from_url(settings.REDIS_URL, decode_responses=True)
    keys = r.keys("btq:*")
    if keys:
        print(f"Borrando {len(keys)} llaves de cola...")
        r.delete(*keys)
    else:
        print("No se encontraron llaves de cola.")
    print("Redis limpio.")


async def clean_db_all_users():
    print("--- Limpiando Base de Datos (Todos los usuarios) ---")
    async for db in get_global_db():
        result = await db.execute(select(User))
        users = result.scalars().all()
        
        for user in users:
            print(f"Procesando usuario: {user.id} ({user.email})")
            async for user_db in get_user_db(user.id):
                # 1. Cancelar todos los libros en proceso
                await user_db.execute(
                    update(Book)
                    .where(Book.status != "complete")
                    .values(status="incomplete", task_id=None, error_msg="Limpieza de emergencia")
                )
                
                # 2. Borrar jobs de análisis
                await user_db.execute(delete(AnalysisJob))
                
                await user_db.commit()
                print(f"  OK: Usuario {user.id} reseteado.")


if __name__ == "__main__":
    clean_redis_all()
    asyncio.run(clean_db_all_users())
    print("\n--- LIMPIEZA COMPLETADA ---")
    print("Ahora intenta reiniciar el stack de Docker y añadir un nuevo análisis.")
