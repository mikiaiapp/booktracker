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


def _format_quota_error(e: Exception) -> str:
    """Convierte error de cuota en mensaje legible con tiempo restante."""
    msg = str(e)
    if msg.startswith("QUOTA_EXCEEDED:"):
        parts = msg.split(":")
        hours = parts[1] if len(parts) > 1 else "?"
        mins = parts[2] if len(parts) > 2 else "?"
        return f"Cuota de IA agotada. Se restablece en {hours}h {mins}min (medianoche UTC)."
    return msg


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
            # Aplicar metadatos — lista explícita de campos válidos
            valid_fields = {
                "title", "author", "isbn", "synopsis", "genre",
                "language", "year", "pages", "author_bio",
                "author_bibliography", "cover_url", "cover_local"
            }
            for k, v in metadata.items():
                if k in valid_fields and v is not None and v != "":
                    try:
                        setattr(book, k, v)
                    except Exception as e:
                        print(f"Phase1 error setting {k}: {e}")

            book.phase1_done = True
            book.status = "identified"
            job.status = "done"
            job.progress = 100
            await db.commit()

        except Exception as e:
            book.status = "error"
            err_msg = str(e)
            if "QUOTA_EXCEEDED" in err_msg:
                book.error_msg = _format_quota_error(e)
                book.status = "quota_exceeded"
            else:
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

            # Resetear capítulos pillados en 'processing' (tarea anterior murió)
            for ch in chapters:
                if ch.summary_status == 'processing':
                    ch.summary_status = 'pending'
            await db.commit()

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

                try:
                    summary_data = await summarize_chapter(
                        chapter.title, chapter.raw_text, book.title, book.author
                    )
                    chapter.summary = summary_data.get("summary")
                    chapter.key_events = summary_data.get("key_events", [])
                    # Si el resumen es un mensaje de bloqueo, marcar como omitido
                    if chapter.summary and chapter.summary.startswith("[Contenido"):
                        chapter.summary_status = "skipped"
                    else:
                        chapter.summary_status = "done"
                except ValueError as e:
                    err_msg = str(e)
                    if "QUOTA_EXCEEDED" in err_msg:
                        chapter.summary_status = "quota_exceeded"
                        chapter.summary = _format_quota_error(e)
                        await db.commit()
                        raise  # Detener fase 3
                    else:
                        chapter.summary_status = "error"
                        chapter.summary = f"Error: {err_msg}"
                await db.commit()

                # Pausa entre capítulos para respetar rate limits (Gemini: 15 req/min, OpenAI TPM)
                if i < len(pending) - 1:
                    pause = 10 if 'gemini' in (settings.AI_MODEL or '').lower() else 15
                    await _asyncio.sleep(pause)

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
            err_msg = str(e)
            if "QUOTA_EXCEEDED" in err_msg:
                chapter.summary_status = "quota_exceeded"
                chapter.summary = _format_quota_error(e)
            else:
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

            # Aplicar metadatos encontrados — lista explícita de campos válidos
            field_map = {
                "title": str, "author": str, "isbn": str,
                "synopsis": str, "genre": str, "language": str,
                "year": int, "pages": int,
                "author_bio": str, "author_bibliography": list,
                "cover_url": str,
            }
            for field, ftype in field_map.items():
                val = metadata.get(field)
                if val is not None and val != "":
                    try:
                        setattr(book, field, val)
                    except Exception as e:
                        print(f"Error setting {field}: {e}")

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


# ── Reidentificar autor: actualiza bio, bibliografía y crea fichas ─────────────
@celery_app.task(bind=True, name="reidentify_author_task")
def reidentify_author_task(self, user_id: str, author_name: str):
    return run_async(_reidentify_author(user_id, author_name))


async def _reidentify_author(user_id: str, author_name: str):
    from app.core.database import get_user_db
    from app.models.book import Book
    from app.services.book_identifier import (
        search_wikipedia_author, get_author_bibliography
    )
    from sqlalchemy import select, func as sqlfunc, or_
    import traceback

    async for db in get_user_db(user_id):
        try:
            import httpx
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
                # 1. Actualizar bio del autor en Wikipedia
                bio_data = await search_wikipedia_author(client, author_name)
                new_bio = bio_data.get("author_bio")

                # 2. Obtener bibliografía actualizada de Google Books
                new_biblio = await get_author_bibliography(author_name)

                # 3. Actualizar todos los libros del autor con nueva bio y bibliografía
                result = await db.execute(
                    select(Book).where(Book.author == author_name)
                )
                books = result.scalars().all()
                for book in books:
                    if new_bio:
                        book.author_bio = new_bio
                    if new_biblio:
                        book.author_bibliography = new_biblio
                await db.commit()

                # 4. Crear fichas para libros de la bibliografía que no existan
                import uuid
                created = 0
                for item in (new_biblio or []):
                    b_title = item.get("title") if isinstance(item, dict) else item
                    b_isbn = item.get("isbn") if isinstance(item, dict) else None
                    if not b_title:
                        continue

                    # Comprobar si ya existe por ISBN o título
                    conditions = []
                    if b_isbn:
                        conditions.append(Book.isbn == b_isbn)
                    conditions.append(
                        sqlfunc.lower(Book.title) == b_title.lower()
                    )
                    existing = await db.execute(
                        select(Book).where(or_(*conditions))
                    )
                    if existing.scalar_one_or_none():
                        continue

                    # Crear ficha shell
                    book_id = str(uuid.uuid4())
                    shell = Book(
                        id=book_id,
                        title=b_title,
                        author=author_name,
                        isbn=b_isbn,
                        author_bio=new_bio,
                        author_bibliography=new_biblio,
                        status="shell",
                        phase1_done=False,
                    )
                    db.add(shell)
                    await db.commit()

                    # Buscar metadatos en background (portada, sinopsis, ISBN)
                    fetch_shell_metadata.delay(user_id, book_id)
                    created += 1
                    print(f"Shell creado: {b_title} ({b_isbn})")

                # 5. Relanzar fetch_shell_metadata en fichas existentes sin portada o sinopsis
                updated = 0
                result2 = await db.execute(
                    select(Book).where(
                        Book.author == author_name,
                        Book.status.in_(["shell", "shell_error"]),
                        or_(
                            Book.cover_local.is_(None),
                            Book.synopsis.is_(None),
                        )
                    )
                )
                incomplete_shells = result2.scalars().all()
                for shell in incomplete_shells:
                    fetch_shell_metadata.delay(user_id, shell.id)
                    updated += 1

                print(f"Autor {author_name} reidentificado. {created} fichas nuevas, {updated} fichas actualizadas.")

        except Exception as e:
            print(f"Error reidentifying author {author_name}: {traceback.format_exc()}")
            raise
