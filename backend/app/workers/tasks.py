import asyncio
import os
import traceback
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
    """Ejecutor de corrutinas mejorado para evitar cuelgues de Celery"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)

async def _get_summaries(db, book_id):
    res = await db.execute(select(Chapter).where(Chapter.book_id == book_id, Chapter.summary_status == "done").order_by(Chapter.order))
    return "\n\n".join([f"[{c.title}]\n{c.summary}" for c in res.scalars().all() if c.summary])

# --- FASES ---

@celery_app.task(name="process_book_phase3")
def process_book_phase3(user_id: str, book_id: str):
    async def _p3():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 3] Iniciando resumenes para {book_id}")
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id))).scalars().all()
            for ch in chaps:
                if ch.summary_status == "done": continue
                s = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author)
                ch.summary, ch.summary_status = s.get("summary"), "done"
                await db.commit()
            print(">>> [FASE 3] Completada. Saltando a FASE 4.")
            process_book_phase4.delay(user_id, book_id)
    return run_async(_p3())

@celery_app.task(name="process_book_phase4")
def process_book_phase4(user_id: str, book_id: str):
    async def _p4():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 4] Iniciando analisis para {book_id}")
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return

            all_summaries = await _get_summaries(db, book_id)
            
            # 1. Personajes
            update_progress(user_id, book_id, "phase4", 85, "Analizando personajes...")
            chars = await analyze_characters(all_summaries, book.title)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            for c in chars:
                db.add(Character(book_id=book_id, name=c.get("name"), role=c.get("role"), description=c.get("description")))
            await db.commit()
            print(f">>> [FASE 4] Personajes guardados: {len(chars)}")

            # 2. Resumen Global
            update_progress(user_id, book_id, "phase4", 90, "Generando resumen global...")
            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            await db.commit()
            print(">>> [FASE 4] Resumen global guardado.")

            # 3. Mapa Mental
            update_progress(user_id, book_id, "phase4", 95, "Generando mapa mental...")
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            
            book.phase3_done, book.status = True, "analyzed"
            await db.commit()
            print(">>> [FASE 4] Fase completada. Lanzando Podcast.")
            generate_podcast.delay(user_id, book_id)

    return run_async(_p4())

@celery_app.task(name="generate_podcast")
def generate_podcast(user_id: str, book_id: str):
    async def _p5():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 5] Iniciando Podcast para {book_id}")
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book or not book.global_summary: return

            script = await generate_podcast_script(book.title, book.author, book.global_summary, [])
            book.podcast_script = script
            
            from app.core.config import settings
            audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            
            try:
                await synthesize_podcast(script, audio_path)
                book.podcast_audio_path = audio_path
            except: pass
            
            book.status = "complete"
            await db.commit()
            print(">>> [FASE 5] PROCESO FINALIZADO.")
            on_done(user_id, book_id)
    return run_async(_p5())