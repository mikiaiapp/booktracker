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

def _check_revocation(user_id: str, book_id: str):
    """Verifica si existe una orden de cancelación o si la cola ha sido limpiada."""
    from app.workers.queue_manager import _r
    r = _r()
    # 1. Chequeo de bandera explícita
    if r.get(f"btq:{user_id}:cancel_flag:{book_id}"):
        print(f"[WORKER] Detención detectada para {book_id}. Abortando.")
        return True
    # 2. Chequeo de existencia del slot activo
    from app.workers.queue_manager import _ak
    active = r.get(_ak(user_id))
    if active and active != book_id:
        print(f"[WORKER] Cambio de libro detectado (slot ocupado por {active}). Abortando {book_id}.")
        return True
    
    # 3. Datos de info borrados (limpieza total)
    from app.workers.queue_manager import _ik
    if not r.exists(_ik(user_id, book_id)):
        print(f"[WORKER] Datos de progreso borrados. Abortando {book_id}.")
        return True
    return False

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
    """Evalúa que fases están realmente hechas basándose en los datos y actualiza el status del libro."""
    # F1: Identificación (Básico: tiene título y autor)
    f1 = bool(book.title and book.author)
    
    # F2: Estructura
    res_ch = await db.execute(select(Chapter).where(Chapter.book_id == book.id))
    chaps = res_ch.scalars().all()
    f2 = len(chaps) > 0
    
    # F3: Resúmenes
    f3 = len(chaps) > 0 and all(c.summary and len(c.summary) > 50 for c in chaps)
    
    # F4: Personajes
    res_char = await db.execute(select(Character).where(Character.book_id == book.id))
    f4 = len(res_char.scalars().all()) > 0
    
    # F5: Mindmap / Global
    f5 = bool(book.global_summary and len(book.global_summary) > 100)
    
    # F6: Podcast
    f6 = bool(book.podcast_script and book.podcast_audio_path)

    book.phase1_done, book.phase2_done, book.phase3_done = f1, f2, f3
    book.phase4_done, book.phase5_done, book.phase6_done = f4, f5, f6
    
    book.status = "complete" if all([f1, f2, f3, f4, f5, f6]) else "incomplete"
    await db.commit()
    missing = [p for p, d in [("F1",f1),("F2",f2),("F3",f3),("F4",f4),("F5",f5),("F6",f6)] if not d]
    print(f"[WORKER] Sincronización final {book.id}: {book.status} (Faltan: {', '.join(missing)})")

async def _dispatch_next(db, user_id, book_id, force=False):
    """Decide cuál es la siguiente tarea basándose en el estado real del libro."""
    from app.workers.queue_manager import on_done
    book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
    if not book: 
        on_done(user_id, book_id)
        return

    await _finalize_book_status(db, book)

    # El orden lógico de las fases
    if not book.phase1_done:
        process_book_phase1.delay(user_id, book_id, chain=True, force=force)
    elif not book.phase2_done:
        process_book_phase2.delay(user_id, book_id, chain=True, force=force)
    elif not book.phase3_done:
        process_book_phase3.delay(user_id, book_id, chain=True, force=force)
    elif not book.phase4_done:
        process_book_phase4.delay(user_id, book_id, chain=True, force=force)
    elif not book.phase5_done:
        process_book_phase5.delay(user_id, book_id, chain=True, force=force)
    elif not book.phase6_done:
        process_book_phase6.delay(user_id, book_id, force=force)
    else:
        # ¡Todo completo!
        print(f"[WORKER] Análisis finalizado con éxito para {book_id}")
        on_done(user_id, book_id)

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
        try:
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
                
                if chain: await _dispatch_next(db, user_id, book_id, force=force)
                else: on_done(user_id, book_id)
        except Exception as e:
            err_msg = str(e)
            print(f"[WORKER] Error F1: {err_msg}")
            update_progress(user_id, book_id, "phase1", 0, f"Error: {err_msg}", model="Error")
            on_done(user_id, book_id)
    return run_async(_p1())

# FASE 2: ESTRUCTURA
@celery_app.task(name="process_book_phase2", bind=True)
def process_book_phase2(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.services.book_parser import parse_book_structure
    from app.workers.queue_manager import update_progress, on_done
    async def _p2():
        try:
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
                
                if chain: await _dispatch_next(db, user_id, book_id, force=force)
                else: on_done(user_id, book_id)
        except Exception as e:
            err_msg = str(e)
            print(f"[WORKER] Error F2: {err_msg}")
            update_progress(user_id, book_id, "phase2", 0, f"Error: {err_msg}", model="Error")
            on_done(user_id, book_id)
    return run_async(_p2())

# FASE 3: RESUMENES DE CAPITULOS
@celery_app.task(name="process_book_phase3", bind=True)
def process_book_phase3(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p3():
        try:
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
                    if ch.summary and len(ch.summary) > 50 and not force: continue
                    pct = int((i/len(chaps))*100)
                    update_progress(user_id, book_id, "phase3", pct, f"F3: Analizando capítulo {i+1} de {len(chaps)} ({ch.title})", model="Buscando IA...")
                    if _check_revocation(user_id, book_id):
                        on_done(user_id, book_id)
                        return

                    res, model_used = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author, api_keys=keys, user_id=user_id, book_id=book_id)
                    if res:
                        ch.summary = res.get("summary")
                        ch.key_events = res.get("key_events", [])
                        ch.summary_status = "done" if (ch.summary and len(ch.summary) > 50) else "pending"
                        await db.commit()
                    update_progress(user_id, book_id, "phase3", pct, f"F3: Resumido {ch.title}", model=model_used)
                    await asyncio.sleep(1)

                await _finalize_book_status(db, book)
                if chain:
                    if not book.phase3_done: process_book_phase3.delay(user_id, book_id, chain=True)
                    else: process_book_phase4.delay(user_id, book_id, chain=True)
                else: on_done(user_id, book_id)
        except ValueError as ve:
            update_progress(user_id, book_id, "phase3", 0, f"Pausa: {ve}", model="Agotado")
            on_done(user_id, book_id)
        except Exception as e:
            err_msg = str(e)
            print(f"[WORKER] Error F3: {err_msg}")
            update_progress(user_id, book_id, "phase3", 0, f"Error: {err_msg}", model="Error")
            on_done(user_id, book_id)
    return run_async(_p3())

# FASE 4: PERSONAJES
@celery_app.task(name="process_book_phase4", bind=True)
def process_book_phase4(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p4():
        try:
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
                char_list, m_list = await get_character_list(all_summaries, api_keys=keys, user_id=user_id, book_id=book_id)
                
                existing_res = await db.execute(select(Character).where(Character.book_id == book_id))
                existing_names = {c.name.lower() for c in existing_res.scalars().all()}
                
                for i, c in enumerate(char_list[:12]):
                    if _check_revocation(user_id, book_id):
                        on_done(user_id, book_id)
                        return
                    char_name = c["name"]
                    if char_name.lower() in existing_names and not force: continue
                        
                    update_progress(user_id, book_id, "phase4", int((i/len(char_list))*100), f"F4: Ficha de {char_name}", model=m_list)
                    detail, m_detail = await analyze_single_character(char_name, c.get("is_main"), all_summaries, book.title, api_keys=keys, user_id=user_id, book_id=book_id)
                    if detail:
                        if char_name.lower() in existing_names:
                            await db.execute(delete(Character).where(Character.book_id == book_id, func.lower(Character.name) == char_name.lower()))
                        db.add(Character(book_id=book_id, **detail))
                        await db.commit()
                
                await _finalize_book_status(db, book)
                if chain: await _dispatch_next(db, user_id, book_id, force=force)
                else: on_done(user_id, book_id)
        except ValueError as ve:
            update_progress(user_id, book_id, "phase4", 0, f"Pausa: {ve}", model="Agotado")
            on_done(user_id, book_id)
        except Exception as e:
            err_msg = str(e)
            print(f"[WORKER] Error F4: {err_msg}")
            update_progress(user_id, book_id, "phase4", 0, f"Error: {err_msg}", model="Error")
            on_done(user_id, book_id)
    return run_async(_p4())

# FASE 5: MAPA MENTAL Y RESUMEN GLOBAL
@celery_app.task(name="process_book_phase5", bind=True)
def process_book_phase5(self, user_id: str, book_id: str, chain: bool = True, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p5():
        try:
            async for db in get_user_db(user_id):
                book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
                if not book: return
                
                update_progress(user_id, book_id, "phase5", 10, "F5: Iniciando ensayo y mapa...", model="Buscando IA...")
                keys = await _get_user_api_keys(user_id)
                all_summaries = await _get_summaries_text(db, book_id)
                
                # Ensayo magistral
                if _check_revocation(user_id, book_id):
                    on_done(user_id, book_id)
                    return
                book.global_summary, m_ensayo = await generate_global_summary(all_summaries, book.title, book.author, api_keys=keys, user_id=user_id, book_id=book_id)
                update_progress(user_id, book_id, "phase5", 50, "F5: Ensayo completado", model=m_ensayo)
                
                # Mapa mental JSON
                if _check_revocation(user_id, book_id):
                    on_done(user_id, book_id)
                    return
                book.mindmap_data, m_mapa = await generate_mindmap(all_summaries, book.title, api_keys=keys, user_id=user_id, book_id=book_id)
                update_progress(user_id, book_id, "phase5", 90, "F5: Mapa mental completado", model=m_mapa)
                
                await db.commit()
                if chain: await _dispatch_next(db, user_id, book_id, force=force)
                else: on_done(user_id, book_id)
        except ValueError as ve:
            update_progress(user_id, book_id, "phase5", 0, f"Pausa: {ve}", model="Agotado")
            on_done(user_id, book_id)
        except Exception as e:
            err_msg = str(e)
            print(f"[WORKER] Error F5: {err_msg}")
            update_progress(user_id, book_id, "phase5", 0, f"Error: {err_msg}", model="Error")
            on_done(user_id, book_id)
    return run_async(_p5())

# FASE 6: PODCAST
@celery_app.task(name="process_book_phase6", bind=True)
def process_book_phase6(self, user_id: str, book_id: str, force: bool = False):
    from app.workers.queue_manager import update_progress, on_done
    async def _p6():
        try:
            async for db in get_user_db(user_id):
                book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
                if not book: return
                if book.phase6_done and not force:
                    on_done(user_id, book_id)
                    return

                update_progress(user_id, book_id, "phase6", 10, "F6: Creando guion de podcast...")
                if _check_revocation(user_id, book_id):
                    on_done(user_id, book_id)
                    return
                    
                keys = await _get_user_api_keys(user_id)
                char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(5))
                chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
                
                script, m_script = await generate_podcast_script(book.title, book.author, book.global_summary, chars, api_keys=keys, user_id=user_id, book_id=book_id)
                book.podcast_script = script
                await db.commit() # Asegurar guardado inmediato del texto
                update_progress(user_id, book_id, "phase6", 40, "F6: Guion finalizado", model=m_script)
                
                update_progress(user_id, book_id, "phase6", 50, "F6: Generando audio (TTS)...")
                audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
                os.makedirs(os.path.dirname(audio_path), exist_ok=True)
                try:
                    # El TTS no suele fallar por IA normal, pero si falla lo capturamos
                    await synthesize_podcast(script, audio_path, api_keys=keys)
                    book.podcast_audio_path = audio_path
                    book.phase6_done = True
                    
                    # Estimación de duración (aprox 150 ppm)
                    words = len(script.split())
                    book.podcast_duration = int(words / 2.5)
                except Exception as e:
                    print(f"[WORKER] Error en TTS: {e}")
                    book.error_msg = f"Error en generación de audio: {str(e)}"
                    update_progress(user_id, book_id, "phase6", 50, f"Error Audio: {e}", model="Error")
                
                await dispatch_next_final(db, user_id, book_id, book)
        except ValueError as ve:
            update_progress(user_id, book_id, "phase6", 0, f"Pausa: {ve}", model="Agotado")
            on_done(user_id, book_id)
        except Exception as e:
            err_msg = str(e)
            print(f"[WORKER] Error F6: {err_msg}")
            update_progress(user_id, book_id, "phase6", 0, f"Error: {err_msg}", model="Error")
            on_done(user_id, book_id)

    async def dispatch_next_final(db, user_id, book_id, book):
        await _finalize_book_status(db, book)
        # Si al llegar aquí falta algo (por re-análisis forzado o error previo) 
        # _dispatch_next encontrará la primera pieza rota.
        await _dispatch_next(db, user_id, book_id, force=False)
    return run_async(_p6())

# --- MANTENIMIENTO Y OTROS ---

@celery_app.task(name="summarize_chapter_task")
def summarize_chapter_task(user_id: str, book_id: str, chapter_id: str):
    from app.workers.queue_manager import update_progress, on_done
    async def _sc():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            ch = (await db.execute(select(Chapter).where(Chapter.id == chapter_id, Chapter.book_id == book_id))).scalar_one_or_none()
            if not book or not ch: return

            update_progress(user_id, book_id, "phase3", 50, f"Analizando {ch.title}...", model="Buscando IA...")
            keys = await _get_user_api_keys(user_id)
            res, model_used = await summarize_chapter(ch.title, ch.raw_text, book.title, book.author, api_keys=keys, user_id=user_id, book_id=book_id)
            
            if res:
                ch.summary = res.get("summary")
                ch.key_events = res.get("key_events", [])
                if ch.summary and len(ch.summary) > 50:
                    ch.summary_status = "done"
                else:
                    ch.summary_status = "pending"
                await db.commit()
                update_progress(user_id, book_id, "phase3", 100, f"Completado: {ch.title}", model=model_used)
            
            # BUSCAR EL SIGUIENTE HUECO DE FORMA LINEAL
            # Buscamos el primer capítulo de este libro que siga sin resumen válido
            from sqlalchemy import or_
            next_chap_stmt = select(Chapter).where(
                Chapter.book_id == book_id, 
                or_(Chapter.summary == None, func.octet_length(Chapter.summary) < 50)
            ).order_by(Chapter.order).limit(1)
            next_chap = (await db.execute(next_chap_stmt)).scalar_one_or_none()
            
            if next_chap:
                print(f"[WORKER] Continuando con siguiente capítulo pendiente: {next_chap.title}")
                summarize_chapter_task.delay(user_id, book_id, next_chap.id)
            else:
                # Todos los capítulos OK, dejar que el despachador decida qué sigue
                await _dispatch_next(db, user_id, book_id, False)
        else:
            on_done(user_id, book_id)
                
    return run_async(_sc())

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

@celery_app.task(name="fetch_shell_metadata")
def fetch_shell_metadata(user_id: str, book_id: str):
    """Tarea de background para buscar metadatos de un libro shell (sin archivo)."""
    from app.services.book_identifier import search_book_metadata, download_cover
    from app.workers.queue_manager import update_progress
    async def _fsm():
        async for db in get_user_db(user_id):
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            
            update_progress(user_id, book_id, "phase1", 20, "Buscando metadatos...")
            keys = await _get_user_api_keys(user_id)
            
            meta = await search_book_metadata(book.title, book.author, api_keys=keys)
            if meta:
                for k, v in meta.items():
                    if hasattr(book, k) and v: setattr(book, k, v)
                
                # Descargar portada si hay URL
                if meta.get("cover_url"):
                    local = await download_cover(meta["cover_url"], os.path.join(settings.COVERS_DIR, user_id), book_id)
                    if local: book.cover_local = local
                
                await db.commit()
                update_progress(user_id, book_id, "phase1", 100, "Metadatos listos")
            else:
                update_progress(user_id, book_id, "phase1", 100, "No se encontraron metadatos adicionales")
                
    return run_async(_fsm())
