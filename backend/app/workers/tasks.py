import asyncio
import os
from sqlalchemy import select, delete, func
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character, AnalysisJob
from app.services.ai_analyzer import (
    summarize_chapter, analyze_characters, 
    generate_global_summary, generate_mindmap, generate_podcast_script
)
from app.services.tts_service import synthesize_podcast
from app.workers.queue_manager import update_progress, on_done

def run_async(coro):
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)

async def _get_summaries_text(db, book_id):
    res = await db.execute(select(Chapter).where(Chapter.book_id == book_id, Chapter.summary_status == "done").order_by(Chapter.order))
    return "\n\n".join([f"[{c.title}]\n{c.summary}" for c in res.scalars().all() if c.summary])

# --- FASES ---

@celery_app.task(name="process_book_phase4")
def process_book_phase4(user_id: str, book_id: str):
    """Fase 4: FORZAR análisis. Limpia datos anteriores siempre."""
    async def _p4():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 4] Forzando ejecución completa para {book_id}")
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return

            job = AnalysisJob(book_id=book_id, phase=4, status="running")
            db.add(job)
            all_summaries = await _get_summaries_text(db, book_id)
            
            # 1. PERSONAJES (LIMPIAR SIEMPRE)
            update_progress(user_id, book_id, "phase4", 85, "Analizando personajes...")
            await db.execute(delete(Character).where(Character.book_id == book_id))
            chars_data = await analyze_characters(all_summaries, book.title)
            
            for c in chars_data:
                # NORMALIZACIÓN CRÍTICA PARA EVITAR PANTALLA EN BLANCO
                # Nos aseguramos de que relaciones sea un dict y el resto listas
                rel = c.get("relationships") if isinstance(c.get("relationships"), dict) else {}
                moments = c.get("key_moments") if isinstance(c.get("key_moments"), list) else []
                quotes = c.get("quotes") if isinstance(c.get("quotes"), list) else []

                db.add(Character(
                    book_id=book_id,
                    name=c.get("name"),
                    role=c.get("role"),
                    description=c.get("description"),
                    personality=c.get("personality"),
                    arc=c.get("arc"),
                    relationships=rel,
                    key_moments=moments,
                    quotes=quotes
                ))
            await db.commit()

            # 2. RESUMEN GLOBAL
            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            await db.commit()

            # 3. MAPA MENTAL
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            
            book.phase3_done, book.status, job.status = True, "analyzed", "done"
            await db.commit()
            print(">>> [FASE 4] Éxito. Lanzando Podcast.")
            generate_podcast.delay(user_id, book_id)
    return run_async(_p4())

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    """Botón específico de reanalizar personajes."""
    async def _re():
        async for db in get_user_db(user_id):
            print(f">>> [REANALIZAR] Personajes de {book_id}")
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            chars = await analyze_characters(all_summaries, book.title)
            for c in chars:
                # Normalización de seguridad
                rel = c.get("relationships") if isinstance(c.get("relationships"), dict) else {}
                db.add(Character(
                    book_id=book_id,
                    name=c.get("name"),
                    role=c.get("role"),
                    description=c.get("description"),
                    personality=c.get("personality"),
                    arc=c.get("arc"),
                    relationships=rel,
                    key_moments=c.get("key_moments", []),
                    quotes=c.get("quotes", [])
                ))
            await db.commit()
    return run_async(_re())

# Mantener generate_podcast y fetch_shell_metadata igual que en la anterior
@celery_app.task(name="generate_podcast")
def generate_podcast(user_id: str, book_id: str):
    async def _p5():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book or not book.global_summary: return
            job = AnalysisJob(book_id=book_id, phase=5, status="running")
            db.add(job)
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(10))
            chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
            script = await generate_podcast_script(book.title, book.author, book.global_summary, chars)
            book.podcast_script, book.status, job.status = script, "complete", "done"
            await db.commit()
            on_done(user_id, book_id)
    return run_async(_p5())