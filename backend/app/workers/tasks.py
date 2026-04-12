import asyncio
import os
from sqlalchemy import select, delete, func
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character, AnalysisJob
from app.services.ai_analyzer import (
    summarize_chapter, get_character_list, analyze_single_character,
    generate_global_summary, generate_mindmap, generate_podcast_script, 
    talk_to_book
)
from app.services.tts_service import synthesize_podcast
from app.core.config import settings

# --- Helpers de Estado ---

def _sanitize_model_name(m_name: str) -> str:
    """Corrige nombres legados o typos antes de mostrarlos al usuario."""
    if not m_name: return "gemini-1.5-flash"
    m_low = str(m_name).lower()
    mapping = {
        "gemini-2.5-flash": "gemini-1.5-flash",
        "gemini-2.1-flash": "gemini-1.5-flash",
        "gemini-2.5-pro": "gemini-1.5-pro"
    }
    return mapping.get(m_low, m_low)

async def _get_user_api_keys(user_id: str) -> dict:
    from app.core.database import get_global_db
    from app.models.user import User
    try:
        async for db in get_global_db():
            res = await db.execute(select(User).where(User.id == user_id))
            user = res.scalar_one_or_none()
            if user:
                return {
                    "gemini": user.gemini_api_key,
                    "openai": user.openai_api_key,
                    "groq": getattr(user, 'groq_api_key', None),
                    "preferred_model": user.preferred_model
                }
    except Exception as e:
        print(f"[WORKER] Error recuperando llaves: {e}")
    return {}

async def _finalize_book_status(db, book):
    """Evalúa que fases están hechas y actualiza el status del libro."""
    missing = []
    if not book.phase1_done: missing.append("F1")
    if not book.phase2_done: missing.append("F2")
    if not book.phase3_done: missing.append("F3")
    if not book.phase4_done: missing.append("F4")
    if not book.phase5_done: missing.append("F5")
    if not book.phase6_done: missing.append("F6")

    if not missing:
        book.status = "complete"
    else:
        book.status = "incomplete"
    
    await db.commit()
    print(f"[WORKER] Estado final para {book.id}: {book.status} (Faltan: {', '.join(missing)})")

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

# --- LAS 6 ESTACIONES DEL ANÁLISIS ---

# FASE 1: IDENTIFICACION
@celery_app.task(name="process_book_phase1", bind=True)
def process_book_phase1(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.services.book_identifier import identify_book
    from app.workers.queue_manager import update_progress, on_done
    async def _p1():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            if book.phase1_done and not force:
                if chain: process_book_phase2.delay(user_id, book_id, chain=True)
                else: on_done(user_id, book_id)
                return

            update_progress(user_id, book_id, "phase1", 5, "F1: Identificando libro y autor...")
            keys = await _get_user_api_keys(user_id)
            meta = await identify_book(book.file_path, book.file_type, book.title, os.path.join(settings.COVERS_DIR, user_id), book_id, api_keys=keys)
            for k, v in meta.items():
                if hasattr(book, k) and v: setattr(book, k, v)
            
            book.phase1_done = True
            book.status = "identified"
            await db.commit()
            
            if chain: process_book_phase2.delay(user_id, book_id, chain=True)
            else: on_done(user_id, book_id)
    return run_async(_p1())

# FASE 2: ESTRUCTURA
@celery_app.task(name="process_book_phase2", bind=True)
def process_book_phase2(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.services.book_parser import parse_book_structure
    from app.workers.queue_manager import update_progress, on_done
    async def _p2():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            if book.phase2_done and not force:
                if chain: process_book_phase3.delay(user_id, book_id, chain=True)
                else: on_done(user_id, book_id)
                return

            update_progress(user_id, book_id, "phase2", 5, "F2: Detectando partes y capítulos...")
            struct = await parse_book_structure(book.file_path, book.file_type)
            await db.execute(delete(Chapter).where(Chapter.book_id == book_id))
            for i, chap in enumerate(struct.get("chapters", [])):
                db.add(Chapter(book_id=book_id, title=chap["title"], order=i, raw_text=chap.get("text", "")[:50000]))
            
            book.phase2_done = True
            book.status = "structured"
            await db.commit()
            
            if chain: process_book_phase3.delay(user_id, book_id, chain=True)
            else: on_done(user_id, book_id)
    return run_async(_p2())

# FASE 3: RESUMENES DE CAPITULOS
@celery_app.task(name="process_book_phase3", bind=True)
def process_book_phase3(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p3():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            if book.phase3_done and not force:
                if chain: process_book_phase4.delay(user_id, book_id, chain=True)
                else: on_done(user_id, book_id)
                return

            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))).scalars().all()
            keys = await _get_user_api_keys(user_id)
            for i, ch in enumerate(chaps):
                if ch.summary_status == "done" and not force: continue
                pct = int((i/len(chaps))*100)
                update_progress(user_id, book_id, "phase3", pct, f"F3: Analizando {ch.title}...", model="Buscando IA...")
                res, model_used = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author, api_keys=keys)
                if res:
                    ch.summary, ch.key_events, ch.summary_status = res.get("summary"), res.get("key_events", []), "done"
                    await db.commit()
                update_progress(user_id, book_id, "phase3", pct, f"F3: Resumido {ch.title}", model=model_used)
                await asyncio.sleep(2) # Evitar saturación

            book.phase3_done = True
            await db.commit()
            
            if chain: process_book_phase4.delay(user_id, book_id, chain=True)
            else: on_done(user_id, book_id)
    return run_async(_p3())

# FASE 4: PERSONAJES
@celery_app.task(name="process_book_phase4", bind=True)
def process_book_phase4(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p4():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            if book.phase4_done and not force:
                if chain: process_book_phase5.delay(user_id, book_id, chain=True)
                else: on_done(user_id, book_id)
                return

            update_progress(user_id, book_id, "phase4", 5, "F4: Extrayendo personajes...", model="Buscando IA...")
            keys = await _get_user_api_keys(user_id)
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            
            char_list, m_list = await get_character_list(all_summaries, api_keys=keys)
            for i, c in enumerate(char_list[:12]): # Optimizado para costo y tiempo
                char_name = c["name"]
                update_progress(user_id, book_id, "phase4", int((i/len(char_list))*100), f"F4: Ficha de {char_name}", model=m_list)
                detail, m_detail = await analyze_single_character(char_name, c.get("is_main"), all_summaries, book.title, api_keys=keys)
                if detail:
                    db.add(Character(book_id=book_id, **detail))
                    await db.commit()
            
            book.phase4_done = True
            await db.commit()
            if chain: process_book_phase5.delay(user_id, book_id, chain=True)
            else: on_done(user_id, book_id)
    return run_async(_p4())

# FASE 5: MAPA MENTAL Y RESUMEN GLOBAL
@celery_app.task(name="process_book_phase5", bind=True)
def process_book_phase5(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p5():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            
            update_progress(user_id, book_id, "phase5", 10, "F5: Iniciando ensayo y mapa...", model="Buscando IA...")
            keys = await _get_user_api_keys(user_id)
            all_summaries = await _get_summaries_text(db, book_id)
            
            # Ensayo magistral
            book.global_summary, m_ensayo = await generate_global_summary(all_summaries, book.title, book.author, api_keys=keys)
            update_progress(user_id, book_id, "phase5", 50, "F5: Ensayo completado", model=m_ensayo)
            
            # Mapa mental JSON
            book.mindmap_data, m_mapa = await generate_mindmap(all_summaries, book.title, api_keys=keys)
            update_progress(user_id, book_id, "phase5", 90, "F5: Mapa mental completado", model=m_mapa)
            
            book.phase5_done = True
            await db.commit()
            if chain: process_book_phase6.delay(user_id, book_id)
            else: on_done(user_id, book_id)
    return run_async(_p5())

# FASE 6: PODCAST
@celery_app.task(name="process_book_phase6", bind=True)
def process_book_phase6(self, user_id: str, book_id: str, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p6():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            if book.phase6_done and not force:
                on_done(user_id, book_id)
                return

            update_progress(user_id, book_id, "phase6", 10, "F6: Creando guion de podcast...")
            keys = await _get_user_api_keys(user_id)
            # Solo los 5 personajes más importantes para el podcast
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(5))
            chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
            
            script, _ = await generate_podcast_script(book.title, book.author, book.global_summary, chars, api_keys=keys)
            book.podcast_script = script
            
            update_progress(user_id, book_id, "phase6", 50, "F6: Generando audio (TTS)...")
            audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            try:
                await synthesize_podcast(script, audio_path)
                book.podcast_audio_path = audio_path
                book.phase6_done = True
            except: pass
            
            await _finalize_book_status(db, book)
            on_done(user_id, book_id)
    return run_async(_p6())

# --- MANTENIMIENTO Y OTROS ---

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    return process_book_phase4.delay(user_id, book_id, chain=False, force=True)

@celery_app.task(name="reidentify_author_task")
def reidentify_author_task(user_id: str, author_name: str):
    # Lógica de autor simplificada
    async def _ra():
        async for db in get_user_db(user_id):
            keys = await _get_user_api_keys(user_id)
            from app.services.book_identifier import get_author_bio_in_spanish
            bio = await get_author_bio_in_spanish(author_name, api_keys=keys)
            books = (await db.execute(select(Book).where(Book.author == author_name))).scalars().all()
            for b in books: b.author_bio = bio
            await db.commit()
    return run_async(_ra())
