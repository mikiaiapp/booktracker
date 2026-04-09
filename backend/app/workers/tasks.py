import asyncio
import os
from sqlalchemy import select, delete, func
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character, AnalysisJob
from app.services.ai_analyzer import *
from app.services.tts_service import synthesize_podcast
from app.core.config import settings

# --- Helpers de Estado ---

async def _finalize_book_status(db, book):
    """
    Evalua que partes del libro estan hechas y actualiza book.status en la DB.
    """
    from app.models.book import Chapter, Character
    from sqlalchemy import select
    
    # Recargar datos frescos
    chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book.id))).scalars().all()
    chars = (await db.execute(select(Character).where(Character.book_id == book.id))).scalars().all()
    
    is_perfect = True
    if not chaps or any((not c.summary or c.summary_status == 'error') for c in chaps): 
        is_perfect = False
    elif not chars or len(chars) == 0: 
        is_perfect = False
    elif not book.global_summary or len(book.global_summary.strip()) < 10: 
        is_perfect = False
    elif not book.mindmap_data or not book.mindmap_data.get("branches"): 
        is_perfect = False
    
    if is_perfect:
        book.status = "complete"
    else:
        book.status = "incomplete" if book.phase2_done else "structured"
    
    await db.commit()
    print(f"[WORKER] Estado finalizado para {book.id}: {book.status}")

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

# --- FASE 1: IDENTIFICACION (FICHA Y AUTOR) ---
@celery_app.task(name="process_book_phase1", bind=True)
def process_book_phase1(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.services.book_identifier import identify_book
    from app.workers.queue_manager import update_progress, on_done
    async def _p1():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase1", 10, "Identificando libro...")
            meta = await identify_book(book.file_path, book.file_type, book.title, os.path.join(settings.COVERS_DIR, user_id), book_id)
            for k, v in meta.items():
                if hasattr(book, k) and v: setattr(book, k, v)
            
            from app.api.books import _find_existing_book
            dup = await _find_existing_book(db, book.title, book.author, book.isbn, exclude_id=book_id) if not force else None
            
            if dup:
                book.status = "duplicate"
                book.error_msg = f"Este libro ya existe en tu biblioteca"
                await db.commit()
                on_done(user_id, book_id)
                return

            # Asegurar que un libro con archivo real nunca sea "shell"
            if book.status == "shell" or not book.status:
                book.status = "identified"
            
            book.phase1_done = True
            await db.commit()
            if book.author: reidentify_author_task.delay(user_id, book.author)
            
            if not book.phase2_done:
                process_book_phase2.delay(user_id, book_id, chain=True)
            else:
                on_done(user_id, book_id)
    return run_async(_p1())

# --- FASE 2: ESTRUCTURA Y RESUMENES ---
@celery_app.task(name="process_book_phase2", bind=True)
def process_book_phase2(self, user_id: str, book_id: str, chain: bool = True):
    from app.services.book_parser import parse_book_structure
    from app.workers.queue_manager import update_progress, on_done
    async def _p2():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase2", 5, "Analizando estructura...")
            struct = await parse_book_structure(book.file_path, book.file_type)
            await db.execute(delete(Chapter).where(Chapter.book_id == book_id))
            for i, chap in enumerate(struct.get("chapters", [])):
                db.add(Chapter(book_id=book_id, title=chap["title"], order=i, raw_text=chap.get("text", "")[:50000]))
            await db.commit()
            
            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))).scalars().all()
            for i, ch in enumerate(chaps):
                update_progress(user_id, book_id, "phase2", int(20 + (i/len(chaps)*40)), f"Resumiendo: {ch.title}")
                res, used_m = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author)
                update_progress(user_id, book_id, "phase2", int(20 + (i/len(chaps)*40)), f"Resumiendo: {ch.title} [{used_m}]", model=used_m)
                if res and res.get("summary"):
                    ch.summary = res.get("summary")
                    ch.key_events = res.get("key_events", [])
                    ch.summary_status = "done"
                else:
                    ch.summary, ch.summary_status = "", "error"
                await db.commit()
                await asyncio.sleep(4)
            
            book.phase2_done = True
            book.status = "structured"
            await db.commit()
            
            if not book.phase3_done:
                process_book_phase3.delay(user_id, book_id, chain=True)
            else:
                on_done(user_id, book_id)
    return run_async(_p2())

# --- FASE 3: PERSONAJES ---
@celery_app.task(name="process_book_phase3", bind=True)
def process_book_phase3(self, user_id: str, book_id: str, chain: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p3():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase3", 5, "Analizando personajes...")
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()
            
            char_list, m_list = await get_character_list(all_summaries)
            for i, c in enumerate(char_list):
                char_name = c["name"]
                update_progress(user_id, book_id, "phase3", int(60+(i/len(char_list)*20)), f"Personaje: {char_name} [{m_list}]", model=m_list)
                detail, m_detail = await analyze_single_character(char_name, c.get("is_main"), all_summaries, book.title)
                update_progress(user_id, book_id, "phase3", int(60+(i/len(char_list)*20)), f"Personaje: {char_name} [{m_detail}]", model=m_detail)
                
                char_data = {
                    "book_id": book_id,
                    "name": char_name,
                    "role": detail.get("role") if detail else "Sin analisis",
                    "description": detail.get("description") if detail else "Sin descripcion",
                    "personality": detail.get("personality") if detail else "Sin analisis",
                    "arc": detail.get("arc") if detail else "Sin analisis",
                    "relationships": detail.get("relationships") if detail and isinstance(detail.get("relationships"), dict) else {},
                    "key_moments": detail.get("key_moments") if detail and isinstance(detail.get("key_moments"), list) else [],
                    "quotes": detail.get("quotes") if detail and isinstance(detail.get("quotes"), list) else []
                }
                db.add(Character(**char_data))
                await db.commit()
                await asyncio.sleep(1)
            
            book.phase3_done = True
            await db.commit()
            
            next_is_empty = not book.global_summary or len(book.global_summary.strip()) < 10
            if next_is_empty:
                process_book_phase4.delay(user_id, book_id, chain=True)
            else:
                if not book.mindmap_data or len(str(book.mindmap_data)) < 50:
                    process_book_phase5.delay(user_id, book_id, chain=True)
                else:
                    await _finalize_book_status(db, book)
                    on_done(user_id, book_id)
    return run_async(_p3())

# --- FASE 4: RESUMEN GLOBAL ---
@celery_app.task(name="process_book_phase4", bind=True)
def process_book_phase4(self, user_id: str, book_id: str, chain: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p4():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase4", 5, "Generando resumen global...")
            
            if chain and book.global_summary and len(book.global_summary.strip()) > 10:
                if not book.mindmap_data:
                    process_book_phase5.delay(user_id, book_id, chain=True)
                else:
                    on_done(user_id, book_id)
                return

            all_summaries = await _get_summaries_text(db, book_id)
            update_progress(user_id, book_id, "phase4", 85, "Redactando ensayo...")
            res_global, m_global = await generate_global_summary(all_summaries, book.title, book.author)
            update_progress(user_id, book_id, "phase4", 95, f"Resumen finalizado [{m_global}]", model=m_global)
            book.global_summary = res_global
            book.has_global_summary = True
            await db.commit()
            
            if not book.mindmap_data or len(str(book.mindmap_data)) < 50:
                process_book_phase5.delay(user_id, book_id, chain=True)
            else:
                await _finalize_book_status(db, book)
                on_done(user_id, book_id)
    return run_async(_p4())

# --- FASE 5: MAPA MENTAL ---
@celery_app.task(name="process_book_phase5", bind=True)
def process_book_phase5(self, user_id: str, book_id: str, chain: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p5():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase5", 5, "Generando mapa mental...")
            
            if chain and book.mindmap_data and len(str(book.mindmap_data)) > 50:
                if not book.podcast_audio_path:
                    process_book_phase6.delay(user_id, book_id)
                else:
                    on_done(user_id, book_id)
                return

            all_summaries = await _get_summaries_text(db, book_id)
            update_progress(user_id, book_id, "phase5", 90, "Estructurando mapa...")
            res_map, m_map = await generate_mindmap(all_summaries, book.title)
            update_progress(user_id, book_id, "phase5", 100, f"Mapa finalizado [{m_map}]", model=m_map)
            book.mindmap_data = res_map
            book.has_mindmap = True
            await db.commit()
            
            if not book.podcast_audio_path or not os.path.exists(book.podcast_audio_path):
                process_book_phase6.delay(user_id, book_id)
            else:
                await _finalize_book_status(db, book)
                on_done(user_id, book_id)
    return run_async(_p5())

# --- FASE 6: PODCAST ---
@celery_app.task(name="process_book_phase6", bind=True)
def process_book_phase6(self, user_id: str, book_id: str):
    from app.workers.queue_manager import update_progress, on_done
    async def _p6():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            update_progress(user_id, book_id, "phase6", 5, "Generando podcast...")
            
            if not (book.podcast_audio_path and os.path.exists(book.podcast_audio_path) and book.podcast_script):
                char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(10))
                chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
                update_progress(user_id, book_id, "phase6", 50, "Redactando guion del podcast...")
                script, m_script = await generate_podcast_script(book.title, book.author, book.global_summary, chars)
                update_progress(user_id, book_id, "phase6", 95, f"Sincronizando audio [{m_script}]", model=m_script)
                book.podcast_script = script
                audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
                os.makedirs(os.path.dirname(audio_path), exist_ok=True)
                try: 
                    await synthesize_podcast(script, audio_path)
                    book.podcast_audio_path = audio_path
                except Exception as e:
                    print(f"[WORKER] Error audio tts: {e}")
            
            book.podcast_done = True
            await db.commit()
            await _finalize_book_status(db, book)
            on_done(user_id, book_id)
    return run_async(_p6())

# --- OTROS ---

@celery_app.task(name="summarize_chapter_task")
def summarize_chapter_task(user_id: str, book_id: str, chapter_id: str):
    from app.workers.queue_manager import update_progress
    async def _task():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            ch   = (await db.execute(select(Chapter).where(Chapter.id == chapter_id, Chapter.book_id == book_id))).scalar_one_or_none()
            if not book or not ch: return
            ch.summary_status = "processing"
            await db.commit()
            update_progress(user_id, book_id, "phase2", 50, f"Resumiendo: {ch.title}")
            try:
                s, m_single = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author)
                update_progress(user_id, book_id, "phase2", 50, f"Resumiendo: {ch.title} [{m_single}]", model=m_single)
                if s and s.get("summary"):
                    ch.summary, ch.key_events, ch.summary_status = s["summary"], s.get("key_events", []), "done"
                else:
                    ch.summary_status = "error"
            except:
                ch.summary_status = "error"
            await db.commit()
            all_chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id))).scalars().all()
            if all(c.summary_status in ("done", "skipped") for c in all_chaps):
                book.phase2_done = True
                book.status = "structured"
                await db.commit()
    return run_async(_task())

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    return process_book_phase3.delay(user_id, book_id, chain=False)

@celery_app.task(name="process_book_repair_events")
def process_book_repair_events(user_id: str, book_id: str):
    from app.services.ai_analyzer import extract_key_events_from_summary
    from app.workers.queue_manager import update_progress, on_done
    async def _task():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return
            res_ch = await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))
            chaps = res_ch.scalars().all()
            total = len(chaps)
            for i, ch in enumerate(chaps):
                update_progress(user_id, book_id, "repair", int((i/total)*100), f"Reparando: {ch.title}")
                events, m_repair = await extract_key_events_from_summary(ch.summary)
                update_progress(user_id, book_id, "repair", int((i/total)*100), f"Reparando: {ch.title} [{m_repair}]", model=m_repair)
                if events: ch.key_events = events; await db.commit()
            on_done(user_id, book_id)
    return run_async(_task())

@celery_app.task(name="reidentify_author_task")
def reidentify_author_task(user_id: str, author_name: str):
    from app.services.book_identifier import get_author_bio_in_spanish, get_author_bibliography
    from app.api.books import _find_existing_book
    import uuid
    async def _ra():
        async for db in get_user_db(user_id):
            bio = await get_author_bio_in_spanish(author_name)
            bib = await get_author_bibliography(author_name)
            for item in bib:
                t = item.get("title")
                if not t: continue
                existing = await _find_existing_book(db, t, author_name, item.get("isbn"))
                if not existing:
                    db.add(Book(id=str(uuid.uuid4()), title=t, author=author_name, isbn=item.get("isbn"), status="shell", phase1_done=True))
            await db.commit()
            books = (await db.execute(select(Book).where(Book.author == author_name))).scalars().all()
            for b in books: b.author_bio, b.author_bibliography = bio, bib
            await db.commit()
    return run_async(_ra())
