import asyncio
import os
from sqlalchemy import select, delete, func
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character, AnalysisJob
from app.services.ai_analyzer import *
from app.services.tts_service import synthesize_podcast
from app.workers.queue_manager import update_progress, on_done
from app.core.config import settings

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

# --- FASE 1: IDENTIFICACIÓN (FICHA Y AUTOR) ---
@celery_app.task(name="process_book_phase1")
def process_book_phase1(user_id: str, book_id: str):
    from app.services.book_identifier import identify_book
    async def _p1():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase1", 10, "Identificando libro...")
            meta = await identify_book(book.file_path, book.file_type, book.title, os.path.join(settings.COVERS_DIR, user_id), book_id)
            for k, v in meta.items():
                if hasattr(book, k) and v: setattr(book, k, v)
            book.phase1_done, book.status = True, "identified"
            await db.commit()
            if book.author: reidentify_author_task.delay(user_id, book.author)
            process_book_phase2.delay(user_id, book_id)
    return run_async(_p1())

# --- FASE 2: ESTRUCTURA Y RESÚMENES INDIVIDUALES ---
@celery_app.task(name="process_book_phase2")
def process_book_phase2(user_id: str, book_id: str):
    from app.services.book_parser import parse_book_structure
    async def _p2():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            struct = await parse_book_structure(book.file_path, book.file_type)
            await db.execute(delete(Chapter).where(Chapter.book_id == book_id))
            for i, chap in enumerate(struct.get("chapters", [])):
                db.add(Chapter(book_id=book_id, title=chap["title"], order=i, raw_text=chap.get("text", "")[:50000]))
            await db.commit()
            
            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))).scalars().all()
            for i, ch in enumerate(chaps):
                update_progress(user_id, book_id, "phase2", int(20 + (i/len(chaps)*40)), f"Resumiendo: {ch.title}")
                s = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author)
                ch.summary, ch.summary_status = s.get("summary"), "done"
                await db.commit()
            
            book.phase2_done = True
            process_book_phase3.delay(user_id, book_id, chain=True)
    return run_async(_p2())

# --- FASE 3: PERSONAJES (PROFUNDO) ---
@celery_app.task(name="process_book_phase3")
def process_book_phase3(user_id: str, book_id: str, chain: bool = False):
    async def _p3():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()
            
            char_list = await get_character_list(all_summaries)
            for i, c in enumerate(char_list):
                char_name = c["name"]
                update_progress(user_id, book_id, "phase3", int(60+(i/len(char_list)*20)), f"Estudio de: {char_name}")
                detail = await analyze_single_character(char_name, c.get("is_main"), all_summaries, book.title)
                
                # Guardar con garantía de datos si detail existe, o al menos con nombre si falla
                char_data = {
                    "book_id": book_id,
                    "name": char_name,
                    "role": detail.get("role") if detail else "Personaje",
                    "description": detail.get("description") if detail else "Sin descripción disponible",
                    "personality": detail.get("personality") if detail else "Sin análisis de personalidad",
                    "arc": detail.get("arc") if detail else "Sin análisis de evolución",
                    "relationships": detail.get("relationships") if detail and isinstance(detail.get("relationships"), dict) else {},
                    "key_moments": detail.get("key_moments") if detail and isinstance(detail.get("key_moments"), list) else [],
                    "quotes": detail.get("quotes") if detail and isinstance(detail.get("quotes"), list) else []
                }
                db.add(Character(**char_data))
                await db.commit()
                await asyncio.sleep(1)
            
            if chain: process_book_phase4.delay(user_id, book_id, chain=True)
            else: on_done(user_id, book_id)
    return run_async(_p3())

# --- FASE 4: RESUMEN GLOBAL ---
@celery_app.task(name="process_book_phase4")
def process_book_phase4(user_id: str, book_id: str, chain: bool = False):
    async def _p4():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            all_summaries = await _get_summaries_text(db, book_id)
            update_progress(user_id, book_id, "phase4", 85, "Redactando ensayo global...")
            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            await db.commit()
            if chain: process_book_phase5.delay(user_id, book_id, chain=True)
            else: on_done(user_id, book_id)
    return run_async(_p4())

# --- FASE 5: MAPA MENTAL ---
@celery_app.task(name="process_book_phase5")
def process_book_phase5(user_id: str, book_id: str, chain: bool = False):
    async def _p5():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            all_summaries = await _get_summaries_text(db, book_id)
            update_progress(user_id, book_id, "phase5", 90, "Estructurando mapa mental...")
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            await db.commit()
            if chain: process_book_phase6.delay(user_id, book_id)
            else: on_done(user_id, book_id)
    return run_async(_p5())

# --- FASE 6: PODCAST ---
@celery_app.task(name="process_book_phase6")
def process_book_phase6(user_id: str, book_id: str):
    async def _p6():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(10))
            chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
            update_progress(user_id, book_id, "phase6", 95, "Sincronizando audio del podcast...")
            script = await generate_podcast_script(book.title, book.author, book.global_summary, chars)
            book.podcast_script = script
            audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            try: await synthesize_podcast(script, audio_path); book.podcast_audio_path = audio_path
            except: pass
            book.status = "complete"
            await db.commit()
            on_done(user_id, book_id)
    return run_async(_p6())

# --- BOTONES DE REANALIZAR (INDIVIDUALES) ---

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    return process_book_phase3.delay(user_id, book_id, chain=False)

@celery_app.task(name="reanalyze_summary_task")
def reanalyze_summary_task(user_id: str, book_id: str):
    return process_book_phase4.delay(user_id, book_id, chain=False)

@celery_app.task(name="reanalyze_mindmap_task")
def reanalyze_mindmap_task(user_id: str, book_id: str):
    return process_book_phase5.delay(user_id, book_id, chain=False)

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

@celery_app.task(name="reidentify_author_task")
def reidentify_author_task(user_id: str, author_name: str):
    from app.services.book_identifier import get_author_bio_in_spanish, get_author_bibliography
    async def _ra():
        async for db in get_user_db(user_id):
            bio = await get_author_bio_in_spanish(author_name)
            bib = await get_author_bibliography(author_name)
            books = (await db.execute(select(Book).where(Book.author == author_name))).scalars().all()
            for b in books: b.author_bio, b.author_bibliography = bio, bib
            await db.commit()
    return run_async(_ra())