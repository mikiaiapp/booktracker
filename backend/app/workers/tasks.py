"""
Async tasks for book processing:
- Phase 1: Identify book, scrape metadata & cover
- Phase 2: Detect parts & chapters from file
- Phase 3: AI summaries per chapter + character analysis
- Podcast: Generate script + TTS audio
"""
import asyncio
import os
from app.workers.celery_app import celery_app


def run_async(coro):
    """Run async coroutine from sync celery task."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Phase 1: Book identification ──────────────────────────────────────────────
@celery_app.task(bind=True, name="process_book_phase1")
def process_book_phase1(self, user_id: str, book_id: str):
    return run_async(_phase1(user_id, book_id))


async def _phase1(user_id: str, book_id: str):
    from app.core.database import get_user_engine, get_user_db
    from app.models.book import Book, AnalysisJob
    from app.services.book_identifier import identify_book
    from sqlalchemy import select
    import traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            if not book:
                return

            job = AnalysisJob(book_id=book_id, phase=1, status="running")
            db.add(job)
            await db.commit()

            metadata = await identify_book(book.file_path, book.file_type, book.title)

            # Update book
            for k, v in metadata.items():
                if hasattr(book, k) and v is not None:
                    setattr(book, k, v)

            book.phase1_done = True
            book.status = "identified"
            job.status = "done"
            job.progress = 100
            await db.commit()

        except Exception as e:
            book.status = "error"
            book.error_msg = traceback.format_exc()
            await db.commit()
            raise


# ── Phase 2: Structure detection ──────────────────────────────────────────────
@celery_app.task(bind=True, name="process_book_phase2")
def process_book_phase2(self, user_id: str, book_id: str):
    return run_async(_phase2(user_id, book_id))


async def _phase2(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, BookPart, Chapter, AnalysisJob
    from app.services.book_parser import parse_book_structure
    from sqlalchemy import select, delete
    import traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()

            job = AnalysisJob(book_id=book_id, phase=2, status="running")
            db.add(job)
            await db.commit()

            structure = await parse_book_structure(book.file_path, book.file_type)

            # Clear old
            await db.execute(delete(BookPart).where(BookPart.book_id == book_id))
            await db.execute(delete(Chapter).where(Chapter.book_id == book_id))

            part_map = {}
            for i, part in enumerate(structure.get("parts", [])):
                p = BookPart(book_id=book_id, title=part["title"], order=i)
                db.add(p)
                await db.flush()
                part_map[part["title"]] = p.id

            for i, chap in enumerate(structure.get("chapters", [])):
                c = Chapter(
                    book_id=book_id,
                    part_id=part_map.get(chap.get("part")),
                    title=chap["title"],
                    order=i,
                    page_start=chap.get("page_start"),
                    page_end=chap.get("page_end"),
                    raw_text=chap.get("text", "")[:50000],  # limit raw text
                )
                db.add(c)

            book.phase2_done = True
            book.status = "structured"
            job.status = "done"
            job.progress = 100
            await db.commit()

        except Exception as e:
            book.status = "error"
            book.error_msg = traceback.format_exc()
            await db.commit()
            raise


# ── Phase 3: AI summaries ─────────────────────────────────────────────────────
@celery_app.task(bind=True, name="process_book_phase3")
def process_book_phase3(self, user_id: str, book_id: str):
    return run_async(_phase3(user_id, book_id))


async def _phase3(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter, Character, AnalysisJob
    from app.services.ai_analyzer import (
        summarize_chapter, analyze_characters,
        generate_global_summary, generate_mindmap
    )
    from sqlalchemy import select
    import json, traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()

            chaps_result = await db.execute(
                select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order)
            )
            chapters = chaps_result.scalars().all()

            job = AnalysisJob(book_id=book_id, phase=3, status="running")
            db.add(job)
            await db.commit()

            total = len(chapters)
            # Filtrar capítulos ya resumidos — permite reanudar donde se dejó
            pending = [c for c in chapters if c.summary_status != "done" and c.raw_text]
            done_count = total - len(pending)

            if done_count > 0:
                job.detail = f"Reanudando desde capítulo {done_count + 1}/{total}…"
                await db.commit()

            import asyncio as _asyncio
            for i, chapter in enumerate(pending):
                global_i = chapters.index(chapter)
                job.progress = int((done_count + i + 1) / total * 60)
                job.detail = f"Resumiendo capítulo {done_count + i + 1}/{total}: {chapter.title}"
                await db.commit()

                chapter.summary_status = "processing"
                await db.commit()

                summary_data = await summarize_chapter(
                    chapter.title, chapter.raw_text, book.title, book.author
                )
                chapter.summary = summary_data.get("summary")
                chapter.key_events = summary_data.get("key_events", [])
                chapter.summary_status = "done"
                await db.commit()

                # Pausa entre capítulos para respetar el rate limit de Gemini free tier
                if i < len(pending) - 1:
                    await _asyncio.sleep(5)

            # Analyze characters
            job.detail = "Analizando personajes..."
            await db.commit()

            all_summaries = "\n\n".join(
                f"[{c.title}]\n{c.summary}" for c in chapters if c.summary
            )
            characters_data = await analyze_characters(all_summaries, book.title)

            for char_data in characters_data:
                existing = await db.execute(
                    select(Character).where(
                        Character.book_id == book_id,
                        Character.name == char_data["name"]
                    )
                )
                char = existing.scalar_one_or_none()
                if not char:
                    char = Character(book_id=book_id, name=char_data["name"])
                    db.add(char)
                for k, v in char_data.items():
                    if hasattr(char, k):
                        setattr(char, k, v)

            job.progress = 80
            job.detail = "Generando resumen global..."
            await db.commit()

            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)

            book.phase3_done = True
            book.status = "analyzed"
            job.status = "done"
            job.progress = 100
            await db.commit()

        except Exception as e:
            book.status = "error"
            book.error_msg = traceback.format_exc()
            await db.commit()
            raise


# ── Podcast generation ────────────────────────────────────────────────────────
@celery_app.task(bind=True, name="generate_podcast")
def generate_podcast(self, user_id: str, book_id: str):
    return run_async(_podcast(user_id, book_id))


async def _podcast(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Character
    from app.services.ai_analyzer import generate_podcast_script
    from app.services.tts_service import synthesize_podcast
    from sqlalchemy import select
    import traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()

            chars_result = await db.execute(select(Character).where(Character.book_id == book_id))
            characters = chars_result.scalars().all()

            script = await generate_podcast_script(
                book.title, book.author, book.global_summary,
                [{"name": c.name, "personality": c.personality, "arc": c.arc} for c in characters]
            )
            book.podcast_script = script

            from app.core.config import settings
            audio_dir = os.path.join(settings.AUDIO_DIR, user_id)
            os.makedirs(audio_dir, exist_ok=True)
            audio_path = os.path.join(audio_dir, f"{book_id}.mp3")

            await synthesize_podcast(script, audio_path)

            book.podcast_audio_path = audio_path
            book.status = "complete"
            await db.commit()

        except Exception as e:
            book.status = "error"
            book.error_msg = traceback.format_exc()
            await db.commit()
            raise


# ── Resumen de un capítulo individual ─────────────────────────
@celery_app.task(bind=True, name="summarize_chapter_task")
def summarize_chapter_task(self, user_id: str, book_id: str, chapter_id: str):
    return run_async(_summarize_single(user_id, book_id, chapter_id))


async def _summarize_single(user_id: str, book_id: str, chapter_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter
    from app.services.ai_analyzer import summarize_chapter
    from sqlalchemy import select
    import traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            ch_result = await db.execute(
                select(Chapter).where(Chapter.id == chapter_id)
            )
            chapter = ch_result.scalar_one_or_none()
            if not chapter or not chapter.raw_text:
                return

            chapter.summary_status = "processing"
            await db.commit()

            summary_data = await summarize_chapter(
                chapter.title, chapter.raw_text,
                book.title if book else "", book.author if book else None
            )
            chapter.summary = summary_data.get("summary")
            chapter.key_events = summary_data.get("key_events", [])
            chapter.summary_status = "done"
            await db.commit()

        except Exception as e:
            chapter.summary_status = "error"
            await db.commit()
            raise


# ── Ficha vacía: solo metadatos web ───────────────────────────
@celery_app.task(bind=True, name="fetch_shell_metadata")
def fetch_shell_metadata(self, user_id: str, book_id: str):
    return run_async(_fetch_shell(user_id, book_id))


async def _fetch_shell(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book
    from app.services.book_identifier import search_book_metadata, download_cover
    from sqlalchemy import select, or_
    from sqlalchemy import func as sqlfunc
    import traceback, os
    from app.core.config import settings

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            if not book:
                return

            metadata = await search_book_metadata(book.title, book.author)

            # Si encontramos un ISBN, comprobar si ya existe otro libro con ese ISBN
            # (deduplicación definitiva por ISBN)
            found_isbn = metadata.get("isbn")
            if found_isbn and found_isbn != book.isbn:
                dup = await db.execute(
                    select(Book).where(
                        Book.isbn == found_isbn,
                        Book.id != book_id
                    )
                )
                if dup.scalar_one_or_none():
                    # Ya existe un libro con ese ISBN — eliminar este duplicado
                    await db.delete(book)
                    await db.commit()
                    print(f"Shell duplicado eliminado: {book.title} (ISBN {found_isbn} ya existe)")
                    return

            # Aplicar todos los metadatos encontrados
            skip_keys = {"_ol_author_key", "cover_url"}
            for k, v in metadata.items():
                if k in skip_keys:
                    continue
                if hasattr(book, k) and v is not None:
                    setattr(book, k, v)

            # Descargar portada
            if metadata.get("cover_url"):
                cover_dir = os.path.join(settings.COVERS_DIR, user_id)
                os.makedirs(cover_dir, exist_ok=True)
                fake_path = os.path.join(settings.UPLOADS_DIR, user_id, f"{book_id}.pdf")
                local_cover = await download_cover(metadata["cover_url"], fake_path)
                if local_cover:
                    book.cover_local = local_cover

            book.phase1_done = True
            book.status = "shell"
            await db.commit()

        except Exception as e:
            try:
                book.status = "shell_error"
                book.error_msg = traceback.format_exc()
                await db.commit()
            except:
                pass
