import asyncio
import os
from sqlalchemy import select, delete, func
from app.workers.celery_app import celery_app
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character, AnalysisJob
from app.services.ai_analyzer import (
    summarize_chapter, get_character_list, analyze_single_character,
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
    """Fase 4: Ejecución SECUENCIAL garantizada."""
    async def _p4():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 4] Iniciando proceso secuencial para {book_id}")
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return

            job = AnalysisJob(book_id=book_id, phase=4, status="running")
            db.add(job)
            await db.commit()

            all_summaries = await _get_summaries_text(db, book_id)
            
            # PASO 1: RESUMEN GLOBAL (Para que el usuario vea algo rápido)
            update_progress(user_id, book_id, "phase4", 82, "Redactando ensayo literario global...")
            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            await db.commit()

            # PASO 2: MAPA MENTAL
            update_progress(user_id, book_id, "phase4", 84, "Estructurando mapa mental detallado...")
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            await db.commit()

            # PASO 3: PERSONAJES (Análisis Individual uno a uno)
            update_progress(user_id, book_id, "phase4", 86, "Buscando personajes...")
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()
            
            char_list = await get_character_list(all_summaries)
            total_chars = len(char_list)
            print(f">>> [FASE 4] {total_chars} personajes detectados. Iniciando análisis individual.")

            for i, c_info in enumerate(char_list):
                name = c_info.get("name")
                pct = int(86 + (i / total_chars * 10))
                update_progress(user_id, book_id, "phase4", pct, f"Analizando personaje {i+1}/{total_chars}: {name}")
                
                detail = await analyze_single_character(name, c_info.get("is_main", False), all_summaries, book.title)
                if detail:
                    db.add(Character(
                        book_id=book_id,
                        name=detail.get("name"),
                        role=detail.get("role"),
                        description=detail.get("description"),
                        personality=detail.get("personality"),
                        arc=detail.get("arc"),
                        relationships=detail.get("relationships") if isinstance(detail.get("relationships"), dict) else {},
                        key_moments=detail.get("key_moments", []),
                        quotes=detail.get("quotes", [])
                    ))
                    await db.commit()
                await asyncio.sleep(2) # Pausa técnica

            # FINALIZACIÓN: Solo ahora el estado pasa a analizado y lanzamos Podcast
            book.phase3_done = True
            book.status = "analyzed"
            job.status = "done"
            await db.commit()
            print(">>> [FASE 4] Completada al 100%. Lanzando Fase 5.")
            generate_podcast.delay(user_id, book_id)

    return run_async(_p4())

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    async def _re():
        async for db in get_user_db(user_id):
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            all_summaries = await _get_summaries_text(db, book_id)
            await db.execute(delete(Character).where(Character.book_id == book_id))
            
            char_list = await get_character_list(all_summaries)
            for c_info in char_list:
                detail = await analyze_single_character(c_info["name"], c_info.get("is_main"), all_summaries, book.title)
                if detail:
                    db.add(Character(book_id=book_id, **{k:v for k,v in detail.items() if hasattr(Character, k)}))
                    await db.commit()
    return run_async(_re())

@celery_app.task(name="generate_podcast")
def generate_podcast(user_id: str, book_id: str):
    async def _p5():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 5] Iniciando Podcast para {book_id}")
            book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            if not book: return
            
            job = AnalysisJob(book_id=book_id, phase=5, status="running")
            db.add(job)
            await db.commit()
            
            char_res = await db.execute(select(Character).where(Character.book_id == book_id).limit(10))
            chars = [{"name": c.name, "personality": c.personality} for c in char_res.scalars().all()]
            
            script = await generate_podcast_script(book.title, book.author, book.global_summary, chars)
            book.podcast_script = script
            
            audio_path = os.path.join(settings.AUDIO_DIR, user_id, f"{book_id}.mp3")
            os.makedirs(os.path.dirname(audio_path), exist_ok=True)
            try:
                await synthesize_podcast(script, audio_path)
                book.podcast_audio_path = audio_path
            except: pass
            
            book.status = "complete"
            job.status = "done"
            await db.commit()
            on_done(user_id, book_id)
    return run_async(_p5())