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

@celery_app.task(name="process_book_phase3")
def process_book_phase3(user_id: str, book_id: str):
    async def _p3():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id))).scalars().all()
            for ch in chaps:
                if ch.summary_status == "done": continue
                s = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author)
                ch.summary, ch.summary_status = s.get("summary"), "done"
                ch.key_events = s.get("key_events", [])
                await db.commit()
            process_book_phase4.delay(user_id, book_id)
    return run_async(_p3())

@celery_app.task(name="process_book_phase4")
def process_book_phase4(user_id: str, book_id: str):
    """Fase 4 completa. Al ejecutarse, limpia y recrea los datos (Resumen, Personajes y Mapa)"""
    async def _p4():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return

            job = AnalysisJob(book_id=book_id, phase=4, status="running")
            db.add(job)
            all_summaries = await _get_summaries_text(db, book_id)
            
            # 1. PERSONAJES (Borrar y Recrear)
            update_progress(user_id, book_id, "phase4", 85, "Analizando personajes...")
            await db.execute(delete(Character).where(Character.book_id == book_id))
            chars_data = await analyze_characters(all_summaries, book.title)
            for c in chars_data:
                db.add(Character(book_id=book_id, **{k:v for k,v in c.items() if hasattr(Character, k)}))
            await db.commit()

            # 2. RESUMEN GLOBAL (Sobrescribir)
            update_progress(user_id, book_id, "phase4", 90, "Generando análisis global...")
            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            await db.commit()

            # 3. MAPA MENTAL (Sobrescribir)
            update_progress(user_id, book_id, "phase4", 95, "Generando mapa mental...")
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            
            book.phase3_done, book.status, job.status = True, "analyzed", "done"
            await db.commit()
            generate_podcast.delay(user_id, book_id)
    return run_async(_p4())

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    """Tarea específica para el botón 'Reanalizar Personajes'"""
    async def _re():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            chars = await analyze_characters(all_summaries, book.title)
            for c in chars:
                db.add(Character(book_id=book_id, **{k:v for k,v in c.items() if hasattr(Character, k)}))
            await db.commit()
    return run_async(_re())

@celery_app.task(name="generate_podcast")
def generate_podcast(user_id: str, book_id: str):
    async def _p5():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book or not book.global_summary: return
            job = AnalysisJob(book_id=book_id, phase=5, status="running")
            db.add(job)
            
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(6))
            chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
            script = await generate_podcast_script(book.title, book.author, book.global_summary, chars)
            book.podcast_script = script
            
            audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            try:
                await synthesize_podcast(script, audio_path)
                book.podcast_audio_path = audio_path
            except: pass
            
            book.status, job.status = "complete", "done"
            await db.commit()
            on_done(user_id, book_id)
    return run_async(_p5())

@celery_app.task(name="fetch_shell_metadata")
def fetch_shell_metadata(user_id: str, book_id: str):
    from app.services.book_identifier import search_book_metadata
    async def _shell():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            meta = await search_book_metadata(book.title, book.author)
            for k, v in meta.items():
                if hasattr(book, k) and v: setattr(book, k, v)
            book.phase1_done, book.status = True, "shell"
            await db.commit()
    return run_async(_shell())