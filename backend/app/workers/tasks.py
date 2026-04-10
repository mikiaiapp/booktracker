import os
from sqlalchemy import select, delete
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character
from app.services.ai_analyzer import (
    summarize_chapter, get_character_list, analyze_single_character,
    generate_global_summary, generate_mindmap, generate_podcast_script,
    extract_key_events_from_summary
)
from app.services.book_identifier import identify_book, get_author_bio_in_spanish, get_author_bibliography
from app.workers.queue_manager import update_progress, on_done
from app.core.config import settings
from app.utils.text_parser import parse_book_structure

# --- Helpers de Estado ---

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
                    "anthropic": user.anthropic_api_key,
                    "preferred_model": user.preferred_model
                }
    except Exception as e:
        print(f"[WORKER] Error recuperando llaves de usuario {user_id}: {e}")
    return {}

async def _finalize_book_status(db, book):
    """
    Evalua que partes del libro estan hechas y actualiza book.status en la DB.
    """
    if book.podcast_audio_path and os.path.exists(book.podcast_audio_path):
        book.status = "complete"
    elif book.global_summary:
        book.status = "analyzed"
    elif book.phase3_done:
        book.status = "chapters_ready"
    elif book.phase2_done:
        book.status = "structure_ready"
    elif book.phase1_done:
        book.status = "identified"
    await db.commit()

async def _get_summaries_text(db, book_id):
    """Concatena los resúmenes de los capítulos en orden."""
    res = await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))
    chaps = res.scalars().all()
    return "\n\n".join([f"CAPÍTULO {c.order + 1}: {c.title}\n{c.summary}" for c in chaps if c.summary])

# --- Tareas de Fases ---

@celery_app.task(name="process_book_phase1")
def process_book_phase1(user_id: str, book_id: str, chain: bool = False, force: bool = False):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: 
                print(f"[WORKER] ERROR: Libro {book_id} no encontrado en la DB")
                return
            keys = await _get_user_api_keys(user_id)
            model_to_log = keys.get("preferred_model") or settings.AI_MODEL
            update_progress(user_id, book_id, "phase1", 10, "Identificando libro...", model=model_to_log)
            print(f"[WORKER] Llamando a identify_book para {book.title}")
            meta = await identify_book(book.file_path, book.file_type, book.title, os.path.join(settings.COVERS_DIR, user_id), book_id, api_keys=keys)
            for k, v in meta.items():
                if hasattr(book, k) and v: setattr(book, k, v)
            
            book.phase1_done = True
            await db.commit()
            
            if chain:
                process_book_phase2.delay(user_id, book_id, chain=True, force=force)
            else:
                on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="process_book_phase2")
def process_book_phase2(user_id: str, book_id: str, chain: bool = False, force: bool = False):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            keys = await _get_user_api_keys(user_id)
            model_to_log = keys.get("preferred_model") or settings.AI_MODEL
            update_progress(user_id, book_id, "phase2", 5, "Analizando estructura...", model=model_to_log)
            struct = await parse_book_structure(book.file_path, book.file_type)
            await db.execute(delete(Chapter).where(Chapter.book_id == book_id))
            for i, chap in enumerate(struct.get("chapters", [])):
                db.add(Chapter(book_id=book_id, title=chap["title"], order=i, raw_text=chap.get("text", "")[:50000]))
            await db.commit()
            
            chaps = (await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))).scalars().all()
            for i, ch in enumerate(chaps):
                update_progress(user_id, book_id, "phase2", int(20 + (i/len(chaps)*40)), f"Resumiendo: {ch.title}")
                res, used_m = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author, api_keys=keys)
                update_progress(user_id, book_id, "phase2", int(20 + (i/len(chaps)*40)), f"Resumiendo: {ch.title} [{used_m}]", model=used_m)
                if res and res.get("summary"):
                    ch.summary = res.get("summary")
                    ch.key_events = res.get("key_events", [])
                    ch.summary_status = "done"
                    await db.commit()

            book.phase2_done = True
            await _finalize_book_status(db, book)
            
            if chain:
                process_book_phase3.delay(user_id, book_id, chain=True, force=force)
            else:
                on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="process_book_phase3")
def process_book_phase3(user_id: str, book_id: str, chain: bool = False, force: bool = False):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            keys = await _get_user_api_keys(user_id)
            model_to_log = keys.get("preferred_model") or settings.AI_MODEL
            update_progress(user_id, book_id, "phase3", 5, "Iniciando análisis de personajes...", model=model_to_log)
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()
            
            char_list, m_list = await get_character_list(all_summaries, api_keys=keys)
            for i, c in enumerate(char_list):
                char_name = c["name"]
                update_progress(user_id, book_id, "phase3", int(60+(i/len(char_list)*20)), f"Personaje: {char_name} [{m_list}]", model=m_list)
                detail, m_detail = await analyze_single_character(char_name, c.get("is_main"), all_summaries, book.title, api_keys=keys)
                update_progress(user_id, book_id, "phase3", int(60+(i/len(char_list)*20)), f"Personaje: {char_name} [{m_detail}]", model=m_detail)
                
                char_data = {
                    "book_id": book_id,
                    "name": char_name,
                    "role": "protagonist" if c.get("is_main") else "secondary",
                    "description": detail.get("description", ""),
                    "personality": detail.get("personality", ""),
                    "arc": detail.get("arc", ""),
                    "relationships": detail.get("relationships", {}),
                    "first_appearance": detail.get("first_appearance", ""),
                    "quotes": detail.get("quotes", [])
                }
                db.add(Character(**char_data))
                await db.commit()

            book.phase3_done = True
            await _finalize_book_status(db, book)
            
            if chain:
                process_book_phase4.delay(user_id, book_id, chain=True, force=force)
            else:
                on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="process_book_phase4")
def process_book_phase4(user_id: str, book_id: str, chain: bool = False, force: bool = False):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            keys = await _get_user_api_keys(user_id)
            model_to_log = keys.get("preferred_model") or settings.AI_MODEL
            update_progress(user_id, book_id, "phase4", 5, "Generando resumen global...", model=model_to_log)
            
            if chain and not force and book.global_summary and len(book.global_summary.strip()) > 10:
                if not book.mindmap_data or force:
                    process_book_phase5.delay(user_id, book_id, chain=True, force=force)
                else:
                    on_done(user_id, book_id)
                return

            all_summaries = await _get_summaries_text(db, book_id)
            update_progress(user_id, book_id, "phase4", 85, "Redactando ensayo...", model=settings.AI_MODEL)
            res_global, m_global = await generate_global_summary(all_summaries, book.title, book.author, api_keys=keys)
            update_progress(user_id, book_id, "phase4", 95, f"Resumen finalizado [{m_global}]", model=m_global)
            book.global_summary = res_global
            book.has_global_summary = True
            await db.commit()
            
            if chain:
                process_book_phase5.delay(user_id, book_id, chain=True, force=force)
            else:
                on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="process_book_phase5")
def process_book_phase5(user_id: str, book_id: str, chain: bool = False, force: bool = False):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            keys = await _get_user_api_keys(user_id)
            model_to_log = keys.get("preferred_model") or settings.AI_MODEL
            update_progress(user_id, book_id, "phase5", 5, "Generando mapa mental...", model=model_to_log)
            
            if chain and not force and book.mindmap_data and len(str(book.mindmap_data)) > 50:
                if not book.podcast_audio_path or force:
                    process_book_phase6.delay(user_id, book_id, force=force)
                else:
                    on_done(user_id, book_id)
                return

            all_summaries = await _get_summaries_text(db, book_id)
            update_progress(user_id, book_id, "phase2", 90, "Estructura finalizada", model=settings.AI_MODEL)
            res_map, m_map = await generate_mindmap(all_summaries, book.title, api_keys=keys)
            update_progress(user_id, book_id, "phase5", 100, f"Mapa finalizado [{m_map}]", model=m_map)
            book.mindmap_data = res_map
            book.has_mindmap = True
            await db.commit()

            if chain:
                process_book_phase6.delay(user_id, book_id, force=force)
            else:
                on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="process_book_phase6")
def process_book_phase6(user_id: str, book_id: str, force: bool = False):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            keys = await _get_user_api_keys(user_id)
            model_to_log = keys.get("preferred_model") or settings.AI_MODEL
            update_progress(user_id, book_id, "phase6", 5, "Generando podcast...", model=model_to_log)
            
            if force or not (book.podcast_audio_path and os.path.exists(book.podcast_audio_path) and book.podcast_script):
                char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(10))
                chars = char_res.scalars().all()
                update_progress(user_id, book_id, "phase6", 5, "Generando guion del podcast...", model=settings.AI_MODEL)
                script, m_script = await generate_podcast_script(book.title, book.author, book.global_summary, chars, api_keys=keys)
                update_progress(user_id, book_id, "phase6", 95, f"Sincronizando audio [{m_script}]", model=m_script)
                book.podcast_script = script
                audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
                os.makedirs(os.path.dirname(audio_path), exist_ok=True)
                # Simular generación de audio (pendiente integración real con TTS)
                with open(audio_path, "wb") as f:
                    f.write(b"Audio content placeholder")
                book.podcast_audio_path = audio_path

            await _finalize_book_status(db, book)
            on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="summarize_chapter_task")
def summarize_chapter_task(user_id: str, book_id: str, chapter_id: str):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            ch = (await db.execute(select(Chapter).where(Chapter.id == chapter_id))).scalar_one_or_none()
            if not book or not ch: return
            ch.summary_status = "processing"
            await db.commit()
            keys = await _get_user_api_keys(user_id)
            update_progress(user_id, book_id, "phase2", 50, f"Resumiendo: {ch.title}")
            try:
                s, m_single = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author, api_keys=keys)
                update_progress(user_id, book_id, "phase2", 50, f"Resumiendo: {ch.title} [{m_single}]", model=m_single)
                if s and s.get("summary"):
                    ch.summary, ch.key_events, ch.summary_status = s["summary"], s.get("key_events", []), "done"
                    await db.commit()
                    await _finalize_book_status(db, book)
                else:
                    ch.summary_status = "error"
                    await db.commit()
            except Exception as e:
                print(f"[WORKER] Error resumiento capítulo: {e}")
                ch.summary_status = "error"
                await db.commit()
            finally:
                on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="process_book_repair_events")
def process_book_repair_events(user_id: str, book_id: str):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            
            res = await db.execute(select(Chapter).where(
                Chapter.book_id == book_id,
                Chapter.summary != None
            ))
            chaps = res.scalars().all()
            total = len(chaps)
            for i, ch in enumerate(chaps):
                update_progress(user_id, book_id, "repair", int((i/total)*100), f"Reparando: {ch.title}")
                keys = await _get_user_api_keys(user_id)
                events, m_repair = await extract_key_events_from_summary(ch.summary, api_keys=keys)
                update_progress(user_id, book_id, "repair", int((i/total)*100), f"Reparando: {ch.title} [{m_repair}]", model=m_repair)
                if events: ch.key_events = events; await db.commit()
            on_done(user_id, book_id)

    asyncio.run(_run())

@celery_app.task(name="reidentify_author_task")
def reidentify_author_task(user_id: str, author_name: str):
    import asyncio
    import uuid
    async def _ra():
        async for db in get_user_db(user_id):
            keys = await _get_user_api_keys(user_id)
            bio = await get_author_bio_in_spanish(author_name, api_keys=keys)
            bib = await get_author_bibliography(author_name, api_keys=keys)
            for item in bib:
                t = item.get("title")
                if not t: continue
                bk = (await db.execute(select(Book).where(Book.author == author_name, Book.title == t))).scalar_one_or_none()
                if bk:
                    bk.author_bio = bio
                    bk.author_bibliography = bib
                    if not bk.synopsis: bk.synopsis = item.get("synopsis")
                    if not bk.isbn: bk.isbn = item.get("isbn")
                    if not bk.year: bk.year = item.get("year")
                    if not bk.cover_url: bk.cover_url = item.get("cover_url")
            await db.commit()
            on_done(user_id, "author_repair")
    asyncio.run(_ra())

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    import asyncio
    async def _run():
        process_book_phase3.delay(user_id, book_id, chain=False, force=True)
    asyncio.run(_run())

@celery_app.task(name="analyze_single_character_task")
def analyze_single_character_task(user_id: str, book_id: str, character_id: str):
    import asyncio
    async def _run():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            char = (await db.execute(select(Character).where(Character.id == character_id))).scalar_one_or_none()
            if not book or not char: return
            all_summaries = await _get_summaries_text(db, book_id)
            keys = await _get_user_api_keys(user_id)
            detail, m = await analyze_single_character(char.name, char.role == "protagonist", all_summaries, book.title, api_keys=keys)
            char.description = detail.get("description", "")
            char.personality = detail.get("personality", "")
            char.arc = detail.get("arc", "")
            char.relationships = detail.get("relationships", {})
            char.quotes = detail.get("quotes", [])
            await db.commit()
            on_done(user_id, book_id)
    asyncio.run(_run())

@celery_app.task(name="fetch_shell_metadata")
def fetch_shell_metadata(user_id: str, book_id: str):
    import asyncio
    async def _run():
        process_book_phase1.delay(user_id, book_id, chain=False, force=True)
    asyncio.run(_run())
