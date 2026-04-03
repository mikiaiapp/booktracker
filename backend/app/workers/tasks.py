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

            from app.core.config import settings
            covers_dir = os.path.join(settings.COVERS_DIR, user_id)
            os.makedirs(covers_dir, exist_ok=True)

            metadata = await identify_book(book.file_path, book.file_type, book.title, covers_dir=covers_dir, book_id=book_id)

            # Guardar autor original ANTES de aplicar metadatos
            original_author = book.author

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

            # ── Normalización de autor ──
            # Unificar el nuevo nombre detectado con variantes ya existentes en BD.
            # Se pasan AMBOS nombres (el original y el nuevo) para que la búsqueda
            # sea más completa y no dependa del estado de la sesión SQLAlchemy.
            new_author = book.author  # puede haber cambiado al aplicar metadata
            if new_author:
                normalized = await _unify_author_name(db, new_author, book_id, original_author)
                if normalized:
                    book.author = normalized
                    metadata["author"] = normalized

            book.phase1_done = True
            book.status = "identified"
            job.status = "done"
            job.progress = 100
            await db.commit()

            # ── Lanzar reidentificación del autor para bio + bibliografía completa ──
            if book.author:
                reidentify_author_task.delay(user_id, book.author)

            # ── Encadenar automáticamente con Fase 2 ──
            process_book_phase2.delay(user_id, book_id)

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


async def _unify_author_name(db, author_name: str, book_id: str, original_author: str = None) -> str | None:
    """
    Busca autores existentes cuyo nombre comparte suficientes palabras con author_name
    o con original_author (el nombre que tenía el libro antes del análisis).
    Cubre inversiones, nombres compuestos y partículas.
    """
    from app.models.book import Book
    from sqlalchemy import select, func

    def normalize(name: str) -> set:
        import re
        stop = {'i', 'y', 'de', 'del', 'la', 'el', 'von', 'van', 'di', 'da', 'du', 'le'}
        # Eliminar puntuación antes de dividir (cubre "Santiago, Mikel" → "Santiago Mikel")
        clean = re.sub(r'[^\w\s]', ' ', name.strip(), flags=re.UNICODE)
        return {w.lower() for w in clean.split() if w.lower() not in stop and len(w) > 1}

    my_words = normalize(author_name)
    orig_words = normalize(original_author) if original_author else set()
    if not my_words:
        return None

    # Excluir el libro actual Y el nombre original (para evitar falsos positivos)
    exclude_names = {author_name}
    if original_author:
        exclude_names.add(original_author)

    result = await db.execute(
        select(Book.author, func.count(Book.id).label("cnt"))
        .where(Book.author.isnot(None), ~Book.author.in_(exclude_names), Book.id != book_id)
        .group_by(Book.author)
    )
    rows = result.all()

    best_match = None
    best_score = 0

    for row in rows:
        other_name = row.author
        other_words = normalize(other_name)
        if not other_words:
            continue

        # Comprobar similitud con el nombre nuevo Y con el original
        common_new = my_words & other_words
        common_orig = orig_words & other_words if orig_words else set()
        common = common_new if len(common_new) >= len(common_orig) else common_orig
        search_words = my_words if len(common_new) >= len(common_orig) else orig_words

        min_common = 1 if (len(search_words) == 1 and len(other_words) == 1) else 2
        jaccard = len(common) / len(search_words | other_words) if (search_words | other_words) else 0

        score = len(common) * jaccard
        if len(common) >= min_common and jaccard >= 0.4 and score > best_score:
            best_score = score
            best_match = (other_name, row.cnt)

    if not best_match:
        return None

    other_name, other_count = best_match

    # Contar libros con el nombre actual (excluyendo el libro que estamos procesando)
    result2 = await db.execute(
        select(func.count(Book.id))
        .where(Book.author.in_(exclude_names), Book.id != book_id)
    )
    current_count = result2.scalar() or 0

    # Canónico = el que tiene más libros; empate → el más largo (más completo)
    if current_count > other_count:
        canonical, redundant = author_name, other_name
    elif other_count > current_count:
        canonical, redundant = other_name, author_name
    else:
        canonical = author_name if len(author_name) >= len(other_name) else other_name
        redundant = other_name if canonical == author_name else author_name

    print(f"Unificando autor: '{redundant}' → '{canonical}'")

    # Actualizar todos los libros con el nombre redundante (incluyendo variantes del original)
    names_to_replace = {redundant}
    if original_author and original_author != canonical:
        names_to_replace.add(original_author)

    redundant_books = await db.execute(select(Book).where(Book.author.in_(names_to_replace)))
    for b in redundant_books.scalars().all():
        b.author = canonical
    await db.commit()

    return canonical


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

            # ── Encadenar automáticamente con Fase 3 (resúmenes) ──
            process_book_phase3.delay(user_id, book_id)

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
    from app.models.book import Book, Chapter, AnalysisJob
    from app.services.ai_analyzer import summarize_chapter
    from sqlalchemy import select
    import asyncio as _asyncio

    async def _db(coro_fn):
        """Ejecuta una función async con su propia sesión de BD."""
        async for db in get_user_db(user_id):
            return await coro_fn(db)

    # ── Paso 1: preparar lista de pendientes ──
    book_title = ""
    book_author = None
    total = 0
    job_id = None

    async def _setup(db):
        nonlocal book_title, book_author, total, job_id
        book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
        if not book:
            return []
        book_title = book.title
        book_author = book.author
        chaps = (await db.execute(
            select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order)
        )).scalars().all()
        total = len(chaps)
        for ch in chaps:
            if ch.summary_status == 'processing':
                ch.summary_status = 'pending'
        job = AnalysisJob(book_id=book_id, phase=3, status="running",
                          detail=f"Iniciando resúmenes ({total} capítulos)")
        db.add(job)
        await db.commit()
        job_id = job.id
        return [(ch.id, ch.title, ch.raw_text)
                for ch in chaps
                if ch.summary_status not in ('done', 'skipped') and ch.raw_text]

    chapter_ids = await _db(_setup)
    if chapter_ids is None:
        return  # libro no encontrado

    done_count = total - len(chapter_ids)
    print(f"Phase3: {len(chapter_ids)} capítulos pendientes de {total} total")

    # ── Paso 2: resumir cada capítulo con reintentos ──
    MAX_RETRIES = 3

    for i, (ch_id, ch_title, ch_text) in enumerate(chapter_ids):
        global_num = done_count + i + 1

        # Marcar como processing
        async def _mark_processing(db, _ch_id=ch_id, _num=global_num, _title=ch_title):
            ch = (await db.execute(select(Chapter).where(Chapter.id == _ch_id))).scalar_one_or_none()
            job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
            if ch: ch.summary_status = 'processing'
            if job:
                job.progress = int(_num / total * 100)
                job.detail = f"Resumiendo capítulo {_num}/{total}: {_title}"
            await db.commit()
        await _db(_mark_processing)

        # Llamada IA con reintentos
        summary_data = None
        error_msg = None
        quota_exceeded = False

        for attempt in range(MAX_RETRIES):
            try:
                summary_data = await summarize_chapter(ch_title, ch_text, book_title, book_author)
                error_msg = None
                break  # éxito
            except Exception as e:
                error_msg = str(e)
                if "QUOTA_EXCEEDED" in error_msg or "rate limit" in error_msg.lower():
                    quota_exceeded = True
                    break  # no reintentar si es cuota
                wait = 15 * (attempt + 1)
                print(f"Error en '{ch_title}' (intento {attempt+1}/{MAX_RETRIES}): {error_msg}. Reintentando en {wait}s…")
                if attempt < MAX_RETRIES - 1:
                    await _asyncio.sleep(wait)

        # Guardar resultado
        async def _save_result(db, _ch_id=ch_id, _title=ch_title):
            ch = (await db.execute(select(Chapter).where(Chapter.id == _ch_id))).scalar_one_or_none()
            book_obj = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
            if ch:
                if quota_exceeded:
                    ch.summary_status = 'quota_exceeded'
                    ch.summary = _format_quota_error(Exception(error_msg)) if error_msg else 'Cuota agotada'
                elif error_msg:
                    print(f"Capítulo '{_title}' marcado como error tras {MAX_RETRIES} intentos: {error_msg}")
                    ch.summary_status = 'error'
                    ch.summary = f"Error: {error_msg[:200]}"
                elif summary_data:
                    ch.summary = summary_data.get("summary", "")
                    ch.key_events = summary_data.get("key_events", [])
                    ch.summary_status = 'skipped' if (ch.summary and ch.summary.startswith("[Contenido")) else 'done'
            if quota_exceeded and book_obj:
                book_obj.status = 'error'
                book_obj.error_msg = ch.summary if ch else 'Cuota agotada'
                if job: job.status = 'error'
            await db.commit()
        await _db(_save_result)

        if quota_exceeded:
            return

        # Pausa entre capítulos (fuera de BD)
        if i < len(chapter_ids) - 1:
            pause = 10 if 'gemini' in (settings.AI_MODEL or '').lower() else 15
            print(f"Capítulo {global_num}/{total} listo. Pausa {pause}s…")
            await _asyncio.sleep(pause)

    # ── Paso 3: marcar completado y encadenar ──
    async def _finish(db):
        job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
        if job:
            job.status = 'done'
            job.progress = 100
            job.detail = f"Resúmenes completados ({total} capítulos)"
        await db.commit()
    await _db(_finish)

    print(f"Phase3 completada: {total} capítulos procesados")
    process_phase3b_task.delay(user_id, book_id)


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

            try:
                await synthesize_podcast(script, audio_path)
                book.podcast_audio_path = audio_path
            except Exception as audio_err:
                print(f"TTS audio failed (script saved anyway): {audio_err}")
                book.podcast_audio_path = None  # Sin audio pero con guión

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
            cover_url_to_use = book.cover_url or metadata.get("cover_url")
            if cover_url_to_use and not book.cover_local:
                cover_dir = os.path.join(settings.COVERS_DIR, user_id)
                local_cover = await download_cover(cover_url_to_use, cover_dir, book_id)
                if local_cover:
                    book.cover_local = local_cover
                    print(f"Portada descargada para {book.title}")

            book.phase1_done = True
            book.status = "shell"
            await db.commit()
            print(f"Shell metadata fetched for {book.title}")

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
            async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
                # 1. Actualizar bio del autor en Wikipedia
                bio_data = await search_wikipedia_author(client, author_name)
                new_bio = bio_data.get("author_bio")
                print(f"Bio obtenida para '{author_name}': {repr(new_bio[:100]) if new_bio else 'None'}")

                # Si la bio está en inglés, traducirla explícitamente aquí
                if new_bio:
                    english_markers = ['the ', ' is ', ' are ', ' was ', ' were ',
                                       ' has ', ' have ', ' of ', ' and ', 'known as', 'born in']
                    hits = sum(1 for m in english_markers if m in new_bio.lower())
                    if hits >= 4:
                        print(f"Bio en inglés detectada ({hits} marcadores). Traduciendo…")
                        try:
                            from app.services.ai_analyzer import _call_ai
                            translated = await _call_ai(
                                "Eres un traductor experto. Traduce el texto al español de forma natural y fluida, manteniendo toda la información original.",
                                f"Traduce esta biografía al español:\n\n{new_bio}",
                                max_tokens=800
                            )
                            if translated and len(translated) > 80:
                                print(f"Traducción exitosa: {repr(translated[:80])}")
                                new_bio = translated.strip()
                            else:
                                print(f"Traducción vacía o muy corta: {repr(translated)}")
                        except Exception as e:
                            print(f"Error en traducción de bio: {e}")

                # 2. Obtener bibliografía actualizada de Google Books (con metadatos completos)
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
                    if not isinstance(item, dict):
                        continue
                    
                    b_title = item.get("title")
                    b_isbn = item.get("isbn")
                    b_year = item.get("year")
                    b_cover_url = item.get("cover_url")
                    b_synopsis = item.get("synopsis")
                    
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

                    # Crear ficha shell con metadatos completos desde bibliografía
                    book_id = str(uuid.uuid4())
                    shell = Book(
                        id=book_id,
                        title=b_title,
                        author=author_name,
                        isbn=b_isbn,
                        year=b_year,
                        synopsis=b_synopsis,
                        cover_url=b_cover_url,
                        author_bio=new_bio,
                        author_bibliography=new_biblio,
                        status="shell",
                        phase1_done=False,
                    )
                    db.add(shell)
                    await db.commit()

                    # Buscar metadatos adicionales y descargar portada en background
                    fetch_shell_metadata.delay(user_id, book_id)
                    created += 1
                    print(f"Shell creado: {b_title} ({b_isbn}) - año: {b_year}")

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


# ── Reanalizar personajes ──────────────────────────────────────
@celery_app.task(bind=True, name="reanalyze_characters_task")
def reanalyze_characters_task(self, user_id: str, book_id: str):
    return run_async(_reanalyze_characters(user_id, book_id))


async def _reanalyze_characters(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter, Character
    from app.services.ai_analyzer import analyze_characters
    from sqlalchemy import select, delete
    import traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            if not book:
                return

            # Obtener todos los resúmenes de capítulos
            chaps = await db.execute(
                select(Chapter).where(
                    Chapter.book_id == book_id,
                    Chapter.summary_status == "done"
                ).order_by(Chapter.order)
            )
            chapters = chaps.scalars().all()
            all_summaries = "\n\n".join(
                f"[{c.title}]\n{c.summary}" for c in chapters if c.summary
            )

            if not all_summaries:
                print(f"No hay resúmenes disponibles para {book.title}")
                return

            # Borrar personajes existentes
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()

            # Reanalizar con el nuevo prompt mejorado
            characters_data = await analyze_characters(all_summaries, book.title)

            for char_data in characters_data:
                char = Character(book_id=book_id, name=char_data["name"])
                db.add(char)
                for k, v in char_data.items():
                    if hasattr(char, k) and k != "name":
                        setattr(char, k, v)

            await db.commit()
            print(f"Personajes reanalizados para {book.title}: {len(characters_data)} personajes")

        except Exception as e:
            print(f"Error reanalizando personajes: {traceback.format_exc()}")
            raise


# ── Fase 3b: personajes + resumen global + mapa mental ────────
@celery_app.task(bind=True, name="process_phase3b_task")
def process_phase3b_task(self, user_id: str, book_id: str):
    return run_async(_phase3b(user_id, book_id))


async def _phase3b(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter, Character
    from app.services.ai_analyzer import analyze_characters, generate_global_summary, generate_mindmap
    from sqlalchemy import select, delete
    import traceback

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            if not book:
                return

            chaps = await db.execute(
                select(Chapter).where(
                    Chapter.book_id == book_id,
                    Chapter.summary_status == "done"
                ).order_by(Chapter.order)
            )
            chapters = chaps.scalars().all()
            all_summaries = "\n\n".join(
                f"[{c.title}]\n{c.summary}" for c in chapters if c.summary
            )

            if not all_summaries:
                book.status = "error"
                book.error_msg = "No hay resúmenes de capítulos disponibles"
                await db.commit()
                return

            # Borrar personajes existentes y reanalizar
            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()

            characters_data = await analyze_characters(all_summaries, book.title)
            for char_data in characters_data:
                char = Character(book_id=book_id, name=char_data["name"])
                db.add(char)
                for k, v in char_data.items():
                    if hasattr(char, k) and k != "name":
                        setattr(char, k, v)

            book.global_summary = await generate_global_summary(all_summaries, book.title, book.author)
            book.mindmap_data = await generate_mindmap(all_summaries, book.title)
            book.phase3_done = True
            book.status = "analyzed"
            await db.commit()
            print(f"Phase 3b complete for {book.title}: {len(characters_data)} characters")

            # ── Encadenar automáticamente con Fase 5 (Podcast) ──
            generate_podcast.delay(user_id, book_id)

        except Exception as e:
            book.status = "error"
            book.error_msg = traceback.format_exc()
            await db.commit()
            raise
