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
    """Fase 4: Ejecución FORZADA. Borra todo y analiza uno a uno."""
    async def _p4():
        async for db in get_user_db(user_id):
            print(f">>> [FASE 4] REINICIANDO ANALISIS COMPLETO para {book_id}")
            res = await db.execute(select(Book).where(Book.id == book_id))
            book = res.scalar_one_or_none()
            if not book: return

            job = AnalysisJob(book_id=book_id, phase=4, status="running")
            db.add(job)
            
            # LIMPIEZA TOTAL PARA REHACER
            book.global_summary = None
            book.mindmap_data = None
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()

            all_summaries = await _get_summaries_text(db, book_id)
            
            # 1. PERSONAJES: Detección + Loop Individual
            update_progress(user_id, book_id, "phase4", 82, "Buscando personajes en la trama...")
            char_list = await get_character_list(all_summaries)
            print(f">>> Detectados {len(char_list)} personajes. Iniciando análisis individual profundo.")

            for i, c_info in enumerate(char_list):
                name = c_info.get("name")
                update_progress(user_id, book_id, "phase4", 82, f"Analizando profundamente a: {name}")
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
                # Pausa para no quemar Rate Limit
                await asyncio.sleep(2)

            # 2. RESUMEN GLOBAL
            update_progress(user_id, book_id, "phase4", 90, "Redactando reseña académica...")
            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            await db.commit()

            # 3. MAPA MENTAL
            update_progress(user_id, book_id, "phase4", 95, "Creando mapa mental...")
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            
            book.phase3_done, book.status, job.status = True, "analyzed", "done"
            await db.commit()
            generate_podcast.delay(user_id, book_id)
    return run_async(_p4())

@celery_app.task(name="reanalyze_characters_task")
def reanalyze_characters_task(user_id: str, book_id: str):
    """Botón reanalizar: aplica la misma lógica de profundidad extrema."""
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
                await asyncio.sleep(1)
    return run_async(_re())

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