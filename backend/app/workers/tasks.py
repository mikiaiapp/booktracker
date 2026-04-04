"""
Async tasks for book processing - Unified and Robust Version.
"""
import asyncio
import os
import traceback
import uuid
import re
from sqlalchemy import select, delete, func, or_
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

# --- Configuración ---
PHASE_MAX_RETRIES = 2
PHASE_RETRY_DELAY = 20

def _format_quota_error(e: Exception) -> str:
    msg = str(e)
    if "QUOTA_EXCEEDED" in msg:
        parts = msg.split(":")
        h = parts[1] if len(parts) > 1 else "?"
        m = parts[2] if len(parts) > 2 else "?"
        return f"Cuota agotada. Se restablece en {h}h {m}min."
    return msg

def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()

# --- Helpers de Normalización y Estado ---

def _normalize_title(t: str) -> str:
    t = t.lower().strip().split(':')[0].split(' / ')[0]
    t = re.sub(r'^(el|la|los|las|un|una|the|a|an)\s+', '', t)
    return re.sub(r'\s+', ' ', t).strip()

def _isbn_base(isbn: str) -> str:
    digits = ''.join(c for c in (isbn or '') if c.isdigit())
    return digits[:9] if len(digits) >= 9 else digits

async def _get_summaries_text(db, book_id: str) -> str:
    res = await db.execute(
        select(Chapter).where(Chapter.book_id == book_id, Chapter.summary_status == "done").order_by(Chapter.order)
    )
    return "\n\n".join([f"[{c.title}]\n{c.summary}" for c in res.scalars().all() if c.summary])

# --- FASES 1, 2 y 3 (Originales mejoradas) ---

@celery_app.task(bind=True, name="process_book_phase1")
def process_book_phase1(self, user_id: str, book_id: str):
    from app.services.book_identifier import identify_book
    async def _p1():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return
            
            update_progress(user_id, book_id, "phase1", 10, "Identificando libro...")
            try:
                meta = await identify_book(book.file_path, book.file_type, book.title, os.path.join(settings.COVERS_DIR, user_id), book_id)
                for k, v in meta.items():
                    if hasattr(book, k) and v: setattr(book, k, v)
                book.phase1_done, book.status = True, "identified"
                await db.commit()
                process_book_phase2.delay(user_id, book_id)
            except Exception as e:
                book.status, book.error_msg = "error", str(e)
                await db.commit()
    return run_async(_p1())

@celery_app.task(bind=True, name="process_book_phase2")
def process_book_phase2(self, user_id: str, book_id: str):
    from app.services.book_parser import parse_book_structure
    async def _p2():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            try:
                struct = await parse_book_structure(book.file_path, book.file_type)
                await db.execute(delete(Chapter).where(Chapter.book_id == book_id))
                for i, chap in enumerate(struct.get("chapters", [])):
                    db.add(Chapter(book_id=book_id, title=chap["title"], order=i, raw_text=chap.get("text", "")[:50000]))
                book.phase2_done, book.status = True, "structured"
                await db.commit()
                process_book_phase3.delay(user_id, book_id)
            except Exception as e:
                book.status = "error"
                await db.commit()
    return run_async(_p2())

@celery_app.task(bind=True, name="process_book_phase3")
def process_book_phase3(self, user_id: str, book_id: str):
    async def _p3():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))).scalars().all()
            for i, ch in enumerate(chaps):
                if ch.summary_status == "done": continue
                update_progress(user_id, book_id, "phase3", int(40 + (i/len(chaps)*40)), f"Resumiendo: {ch.title}")
                try:
                    s = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author)
                    ch.summary, ch.key_events, ch.summary_status = s.get("summary"), s.get("key_events"), "done"
                    await db.commit()
                except Exception as e:
                    if "QUOTA" in str(e): break
            process_book_phase4.delay(user_id, book_id)
    return run_async(_p3())

# --- FASE 4: PERSONAJES + RESUMEN + MAPA (ROBUSTA E IDEMPOTENTE) ---

@celery_app.task(bind=True, name="process_book_phase4")
def process_book_phase4(self, user_id: str, book_id: str):
    return run_async(_phase4_robust(self, user_id, book_id))

async def _phase4_robust(self, user_id: str, book_id: str):
    async for db in get_user_db(user_id):
        res = await db.execute(select(Book).where(Book.id == book_id))
        book = res.scalar_one_or_none()
        if not book: return

        job = AnalysisJob(book_id=book_id, phase=4, status="running")
        db.add(job)
        await db.commit()

        try:
            all_summaries = await _get_summaries_text(db, book_id)
            if not all_summaries: raise ValueError("No hay resúmenes disponibles.")

            # 1. Personajes (Si no existen)
            char_exists = (await db.execute(select(func.count(Character.id)).where(Character.book_id == book_id))).scalar()
            if char_exists == 0:
                update_progress(user_id, book_id, "phase4", 83, "Analizando personajes...")
                chars = await asyncio.wait_for(analyze_characters(all_summaries, book.title), timeout=360)
                for c_data in chars:
                    db.add(Character(book_id=book_id, **{k:v for k,v in c_data.items() if hasattr(Character, k)}))
                await db.commit()

            # 2. Resumen Global (Si no existe)
            if not book.global_summary:
                update_progress(user_id, book_id, "phase4", 90, "Generando resumen global...")
                book.global_summary = await asyncio.wait_for(generate_global_summary(all_summaries, book.title, book.author), timeout=300)
                await db.commit()

            # 3. Mapa Mental (Si no existe)
            if not book.mindmap_data:
                update_progress(user_id, book_id, "phase4", 95, "Creando mapa mental...")
                book.mindmap_data = await asyncio.wait_for(generate_mindmap(all_summaries, book.title), timeout=300)
                await db.commit()

            book.phase3_done, book.status, job.status = True, "analyzed", "done"
            await db.commit()
            
            # Encadenar Podcast
            generate_podcast.delay(user_id, book_id)

        except Exception as e:
            await db.rollback()
            if self.request.retries >= PHASE_MAX_RETRIES:
                book.status, job.status = "error", "error"
                book.error_msg = _format_quota_error(e)
                await db.commit()
                on_done(user_id, book_id)
            else:
                raise self.retry(exc=e, countdown=PHASE_RETRY_DELAY)

# --- FASE 5: PODCAST ---

@celery_app.task(bind=True, name="generate_podcast")
def generate_podcast(self, user_id: str, book_id: str):
    return run_async(_podcast_robust(self, user_id, book_id))

async def _podcast_robust(self, user_id: str, book_id: str):
    async for db in get_user_db(user_id):
        book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
        if not book: return
        job = AnalysisJob(book_id=book_id, phase=5, status="running")
        db.add(job)
        await db.commit()

        try:
            update_progress(user_id, book_id, "podcast", 97, "Generando audio del podcast...")
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(5))
            chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
            
            script = await asyncio.wait_for(generate_podcast_script(book.title, book.author, book.global_summary, chars), timeout=400)
            book.podcast_script = script
            
            audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            await synthesize_podcast(script, audio_path)
            
            book.podcast_audio_path, book.status, job.status = audio_path, "complete", "done"
            await db.commit()
            on_done(user_id, book_id)
        except Exception as e:
            await db.rollback()
            if self.request.retries >= PHASE_MAX_RETRIES:
                book.status, job.status = "error", "error"
                await db.commit()
                on_done(user_id, book_id)
            else:
                raise self.retry(exc=e, countdown=PHASE_RETRY_DELAY)

# --- OTROS (Shell, Reidentificar) ---

@celery_app.task(name="fetch_shell_metadata")
def fetch_shell_metadata(user_id: str, book_id: str):
    from app.services.book_identifier import search_book_metadata, download_cover
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

@celery_app.task(name="reidentify_author_task")
def reidentify_author_task(user_id: str, author_name: str):
    from app.services.book_identifier import get_author_bio_in_spanish, get_author_bibliography
    async def _reauthor():
        async for db in get_user_db(user_id):
            bio = await get_author_bio_in_spanish(author_name)
            bib = await get_author_bibliography(author_name)
            books = (await db.execute(select(Book).where(Book.author == author_name))).scalars().all()
            for b in books:
                b.author_bio, b.author_bibliography = bio, bib
            await db.commit()
    return run_async(_reauthor())