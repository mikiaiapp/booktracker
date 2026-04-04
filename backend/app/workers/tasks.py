import asyncio
import os
import traceback
from sqlalchemy import select, delete, func
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, BookPart, Chapter, Character, AnalysisJob
from app.services.ai_analyzer import (
    summarize_chapter, analyze_characters, 
    generate_global_summary, generate_mindmap, generate_podcast_script
)
from app.services.tts_service import synthesize_podcast
from app.workers.queue_manager import update_progress, on_done
from app.core.config import settings

# --- Configuración Optimizada ---
PHASE_MAX_RETRIES = 2   # Suficiente para errores temporales de red
PHASE_RETRY_DELAY = 15  # Segundos entre reintentos

def _format_quota_error(e: Exception) -> str:
    msg = str(e)
    if "QUOTA_EXCEEDED" in msg:
        parts = msg.split(":")
        h = parts[1] if len(parts) > 1 else "?"
        m = parts[2] if len(parts) > 2 else "?"
        return f"Cuota agotada. Restablecimiento en {h}h {m}min."
    return msg

def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

# --- Helpers de Estado ---

async def _get_all_summaries(db, book_id: str) -> str:
    res = await db.execute(
        select(Chapter).where(Chapter.book_id == book_id, Chapter.summary_status == "done").order_by(Chapter.order)
    )
    chapters = res.scalars().all()
    return "\n\n".join([f"[{c.title}]\n{c.summary}" for c in chapters if c.summary])

# --- Tareas Principales ---

@celery_app.task(bind=True, name="process_book_phase4")
def process_book_phase4(self, user_id: str, book_id: str):
    """
    Fase 4 Mejorada: Ejecución secuencial con guardado parcial.
    Si falla el paso 3, el paso 1 y 2 no se repiten al reintentar.
    """
    return run_async(_phase4_robust(user_id, book_id))

async def _phase4_robust(user_id: str, book_id: str):
    async for db in get_user_db(user_id):
        # 1. Preparación
        res = await db.execute(select(Book).where(Book.id == book_id))
        book = res.scalar_one_or_none()
        if not book: return

        job = AnalysisJob(book_id=book_id, phase=4, status="running")
        db.add(job)
        await db.commit()

        try:
            all_summaries = await _get_all_summaries(db, book_id)
            if not all_summaries:
                raise ValueError("No hay resúmenes de capítulos para analizar.")

            # --- PASO A: PERSONAJES (Si no existen) ---
            char_count = (await db.execute(select(func.count(Character.id)).where(Character.book_id == book_id))).scalar()
            if char_count == 0:
                update_progress(user_id, book_id, "phase4", 83, "Analizando todos los personajes...")
                chars_data = await asyncio.wait_for(analyze_characters(all_summaries, book.title), timeout=300)
                for c_data in chars_data:
                    db.add(Character(book_id=book_id, **c_data))
                await db.commit()
                print(f"Paso A completado: {len(chars_data)} personajes.")

            # --- PASO B: RESUMEN GLOBAL (Si no existe) ---
            if not book.global_summary:
                update_progress(user_id, book_id, "phase4", 90, "Generando análisis global...")
                summary = await asyncio.wait_for(generate_global_summary(all_summaries, book.title, book.author), timeout=250)
                book.global_summary = summary
                await db.commit()
                print("Paso B completado: Resumen global generado.")

            # --- PASO C: MAPA MENTAL (Si no existe) ---
            if not book.mindmap_data or len(book.mindmap_data.get('branches', [])) == 0:
                update_progress(user_id, book_id, "phase4", 95, "Creando mapa mental...")
                mmap = await asyncio.wait_for(generate_mindmap(all_summaries, book.title), timeout=200)
                book.mindmap_data = mmap
                await db.commit()
                print("Paso C completado: Mapa mental generado.")

            # Finalización de fase
            book.phase3_done = True
            book.status = "analyzed"
            job.status = "done"
            await db.commit()

            # Encadenar Podcast
            if not book.podcast_script:
                generate_podcast.delay(user_id, book_id)

        except Exception as e:
            await db.rollback()
            msg = str(e)
            is_quota = "QUOTA_EXCEEDED" in msg
            
            # Si es cuota o ya agotamos reintentos, marcar error final
            if is_quota or self.request.retries >= PHASE_MAX_RETRIES:
                book.status = "quota_exceeded" if is_quota else "error"
                book.error_msg = _format_quota_error(e)
                job.status = "error"
                await db.commit()
                on_done(user_id, book_id)
            else:
                # Reintentar la tarea de Celery
                print(f"Reintentando Fase 4 por error: {msg[:100]}")
                raise self.retry(exc=e, countdown=PHASE_RETRY_DELAY)

@celery_app.task(bind=True, name="generate_podcast")
def generate_podcast(self, user_id: str, book_id: str):
    return run_async(_podcast_robust(user_id, book_id, self))

async def _podcast_robust(user_id: str, book_id: str, celery_task):
    async for db in get_user_db(user_id):
        res = await db.execute(select(Book).where(Book.id == book_id))
        book = res.scalar_one_or_none()
        if not book or not book.global_summary: return

        job = AnalysisJob(book_id=book_id, phase=5, status="running")
        db.add(job)
        await db.commit()

        try:
            update_progress(user_id, book_id, "podcast", 97, "Redactando guion del podcast...")
            
            # Obtener personajes para el guion
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(10))
            chars = char_res.scalars().all()
            char_list = [{"name": c.name, "personality": c.personality} for c in chars]

            script = await asyncio.wait_for(
                generate_podcast_script(book.title, book.author, book.global_summary, char_list), 
                timeout=300
            )
            book.podcast_script = script
            await db.commit()

            # TTS Audio
            audio_dir = os.path.join(settings.AUDIO_DIR, user_id)
            os.makedirs(audio_dir, exist_ok=True)
            audio_path = os.path.join(audio_dir, f"{book_id}.mp3")
            
            await synthesize_podcast(script, audio_path)
            book.podcast_audio_path = audio_path
            
            book.status = "complete"
            job.status = "done"
            await db.commit()
            on_done(user_id, book_id)

        except Exception as e:
            await db.rollback()
            if "QUOTA_EXCEEDED" in str(e) or celery_task.request.retries >= PHASE_MAX_RETRIES:
                book.status = "error"
                book.error_msg = _format_quota_error(e)
                job.status = "error"
                await db.commit()
                on_done(user_id, book_id)
            else:
                raise celery_task.retry(exc=e, countdown=PHASE_RETRY_DELAY)