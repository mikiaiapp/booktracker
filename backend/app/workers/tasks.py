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


# ── Normalización de nombre de autor ─────────────────────────────────────────

def _normalize_author_words(name: str) -> set:
    """
    Normaliza un nombre de autor a un conjunto de palabras significativas.
    Elimina puntuación (cubre 'Apellido, Nombre'), partículas y palabras cortas.
    """
    import re
    stop = {'i', 'y', 'de', 'del', 'la', 'el', 'von', 'van', 'di', 'da', 'du', 'le'}
    clean = re.sub(r'[^\w\s]', ' ', name.strip(), flags=re.UNICODE)
    return {w.lower() for w in clean.split() if w.lower() not in stop and len(w) > 1}


def _is_name_inversion(name_a: str, name_b: str) -> bool:
    """
    Detecta si dos nombres son el mismo autor con apellido/nombre invertidos.
    Ej: 'Mikel Santiago' == 'Santiago, Mikel'
    Funciona con 2 o más palabras, ignorando comas.
    """
    import re
    clean = lambda s: re.sub(r'[^\w\s]', ' ', s.strip(), flags=re.UNICODE).lower().split()
    words_a = set(clean(name_a))
    words_b = set(clean(name_b))
    # Mismas palabras en cualquier orden = inversión segura
    return len(words_a) >= 2 and words_a == words_b


def _normalize_title(t: str) -> str:
    """Normaliza título para comparación: minúsculas, sin subtítulos ni artículos."""
    import re
    t = t.lower().strip()
    t = t.split(':')[0].split(' / ')[0]
    t = re.sub(r'\s*\([^)]*\)', '', t)
    t = re.sub(r'\b(novela|roman|novel|libro)\b', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(el|la|los|las|un|una|the|a|an|le|les|der|die|das)\s+', '', t.strip())
    return re.sub(r'\s+', ' ', t).strip()


def _isbn_base(isbn: str) -> str:
    """Primeros 9 dígitos del ISBN-13 = misma obra, distintas ediciones."""
    digits = ''.join(c for c in (isbn or '') if c.isdigit())
    return digits[:9] if len(digits) >= 9 else digits


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
            new_author = book.author
            if new_author:
                normalized = await _unify_author_name(db, new_author, book_id, original_author)
                if normalized:
                    book.author = normalized
                    metadata["author"] = normalized

            # ── Deduplicación: comprobar si este libro ya existe como shell ──
            # Buscar por ISBN primero (más fiable), luego por título normalizado
            final_author = book.author
            final_isbn = book.isbn
            final_title = book.title

            duplicate_shell = await _find_duplicate_shell(
                db, book_id, final_title, final_author, final_isbn
            )
            if duplicate_shell:
                print(f"Phase1: libro '{final_title}' coincide con shell {duplicate_shell.id} — promoviendo")
                # Transferir el archivo al shell existente y eliminar este libro
                duplicate_shell.file_path = book.file_path
                duplicate_shell.file_type = book.file_type
                duplicate_shell.file_size = book.file_size
                duplicate_shell.status = "uploaded"
                duplicate_shell.phase1_done = False
                duplicate_shell.phase2_done = False
                duplicate_shell.phase3_done = False
                # Enriquecer con metadatos recién obtenidos si el shell no los tenía
                if not duplicate_shell.cover_local and book.cover_local:
                    duplicate_shell.cover_local = book.cover_local
                if not duplicate_shell.cover_url and book.cover_url:
                    duplicate_shell.cover_url = book.cover_url
                if not duplicate_shell.synopsis and book.synopsis:
                    duplicate_shell.synopsis = book.synopsis
                if not duplicate_shell.isbn and final_isbn:
                    duplicate_shell.isbn = final_isbn
                await db.delete(book)
                await db.commit()
                # Relanzar fase 1 sobre el shell promovido
                process_book_phase1.delay(user_id, duplicate_shell.id)
                return

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


async def _find_duplicate_shell(db, current_book_id: str, title: str, author: str, isbn: str):
    """
    Busca si existe una ficha shell del mismo libro.
    Comprueba por ISBN exacto O por título normalizado + autor.
    Solo devuelve shells (libros sin archivo), nunca libros analizados.
    """
    from app.models.book import Book
    from sqlalchemy import select, or_

    conditions = []

    # Por ISBN exacto (si tenemos ISBN)
    if isbn:
        conditions.append(
            (Book.isbn == isbn) &
            Book.id.isnot(current_book_id) &
            Book.status.in_(["shell", "shell_error"])
        )

    # Por ISBN base (misma obra, diferente edición)
    if isbn and _isbn_base(isbn):
        base = _isbn_base(isbn)
        # No podemos hacer SUBSTR en SQLAlchemy de forma genérica fácilmente,
        # lo haremos en Python después de cargar candidatos

    # Por título normalizado + autor
    if title:
        conditions.append(
            Book.status.in_(["shell", "shell_error"]) &
            Book.id.isnot(current_book_id)
        )

    if not conditions:
        return None

    # Cargar todos los shells del mismo autor (o sin autor aún)
    author_filter = []
    if author:
        author_filter = [Book.author == author, Book.author.is_(None)]
    else:
        author_filter = [Book.author.is_(None)]

    result = await db.execute(
        select(Book).where(
            Book.status.in_(["shell", "shell_error"]),
            Book.id != current_book_id,
        )
    )
    shells = result.scalars().all()

    norm_title = _normalize_title(title or "")
    isbn_base = _isbn_base(isbn or "")
    author_words = _normalize_author_words(author or "")

    for shell in shells:
        # Comprobar que el autor coincide (o el shell aún no tiene autor)
        if shell.author and author:
            shell_words = _normalize_author_words(shell.author)
            author_match = (
                shell.author == author or
                _is_name_inversion(shell.author, author) or
                (len(shell_words & author_words) >= 2)
            )
            if not author_match:
                continue

        # Match por ISBN exacto
        if isbn and shell.isbn and shell.isbn == isbn:
            return shell

        # Match por ISBN base (misma obra, edición diferente)
        if isbn_base and shell.isbn and _isbn_base(shell.isbn) == isbn_base:
            return shell

        # Match por título normalizado
        if norm_title and shell.title:
            shell_norm = _normalize_title(shell.title)
            if shell_norm == norm_title:
                return shell

    return None


async def _unify_author_name(db, author_name: str, book_id: str, original_author: str = None) -> str | None:
    """
    Busca autores existentes cuyo nombre comparte suficientes palabras con author_name
    o con original_author (el nombre que tenía el libro antes del análisis).
    Cubre inversiones (Apellido, Nombre), nombres compuestos y partículas.
    """
    from app.models.book import Book
    from sqlalchemy import select, func

    my_words = _normalize_author_words(author_name)
    orig_words = _normalize_author_words(original_author) if original_author else set()
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
        other_words = _normalize_author_words(other_name)
        if not other_words:
            continue

        # ── Caso especial: inversión nombre/apellido garantizada ──
        # Si las palabras son exactamente las mismas (en cualquier orden), es el mismo autor
        if _is_name_inversion(author_name, other_name):
            print(f"Inversión detectada: '{author_name}' ↔ '{other_name}'")
            best_match = (other_name, row.cnt)
            best_score = 999  # prioridad máxima
            break

        # También comprobar con el nombre original
        if original_author and _is_name_inversion(original_author, other_name):
            print(f"Inversión detectada (original): '{original_author}' ↔ '{other_name}'")
            best_match = (other_name, row.cnt)
            best_score = 999
            break

        # ── Similitud general por palabras compartidas ──
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
def process_book_phase3(self, user_id: str, book_id: str, chain_next: bool = True):
    return run_async(_phase3(user_id, book_id, chain_next))


async def _phase3(user_id: str, book_id: str, chain_next: bool = True):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter, AnalysisJob
    from app.services.ai_analyzer import summarize_chapter
    from app.core.config import settings
    from sqlalchemy import select
    import asyncio as _asyncio

    # ── Paso 1: preparar lista de pendientes ──
    book_title = ""
    book_author = None
    total = 0
    job_id = None
    chapter_ids = []

    async for db in get_user_db(user_id):
        book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
        if not book:
            return
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
        chapter_ids = [
            (ch.id, ch.title, ch.raw_text)
            for ch in chaps
            if ch.summary_status not in ('done', 'skipped') and ch.raw_text
        ]

    if not job_id:
        return

    done_count = total - len(chapter_ids)
    print(f"Phase3: {len(chapter_ids)} capítulos pendientes de {total} total")

    # ── Paso 2: resumir cada capítulo ──
    MAX_RETRIES = 3

    for i, (ch_id, ch_title, ch_text) in enumerate(chapter_ids):
        global_num = done_count + i + 1
        print(f"Phase3: iniciando capítulo {global_num}/{total}: {ch_title}")

        async for db in get_user_db(user_id):
            ch = (await db.execute(select(Chapter).where(Chapter.id == ch_id))).scalar_one_or_none()
            job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
            if ch:
                ch.summary_status = 'processing'
            if job:
                job.progress = int(global_num / total * 100)
                job.detail = f"Resumiendo capítulo {global_num}/{total}: {ch_title}"
            await db.commit()

        summary_data = None
        error_msg = None
        quota_exceeded = False

        for attempt in range(MAX_RETRIES):
            try:
                summary_data = await summarize_chapter(ch_title, ch_text, book_title, book_author)
                error_msg = None
                print(f"Phase3: capítulo {global_num} resumido OK")
                break
            except Exception as e:
                error_msg = str(e)
                if "QUOTA_EXCEEDED" in error_msg or "rate limit" in error_msg.lower():
                    quota_exceeded = True
                    break
                wait = 15 * (attempt + 1)
                print(f"Phase3: error intento {attempt+1}/{MAX_RETRIES} en '{ch_title}': {error_msg[:100]}. Reintento en {wait}s")
                if attempt < MAX_RETRIES - 1:
                    await _asyncio.sleep(wait)

        _summary_data = summary_data
        _error_msg = error_msg
        _quota_exceeded = quota_exceeded

        async for db in get_user_db(user_id):
            ch = (await db.execute(select(Chapter).where(Chapter.id == ch_id))).scalar_one_or_none()
            book_obj = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()

            if ch:
                if _quota_exceeded:
                    ch.summary_status = 'quota_exceeded'
                    ch.summary = _format_quota_error(Exception(_error_msg)) if _error_msg else 'Cuota agotada'
                elif _error_msg:
                    print(f"Phase3: '{ch_title}' marcado como error: {_error_msg[:100]}")
                    ch.summary_status = 'error'
                    ch.summary = f"Error: {_error_msg[:200]}"
                elif _summary_data:
                    ch.summary = _summary_data.get("summary", "")
                    ch.key_events = _summary_data.get("key_events", [])
                    if ch.summary and ch.summary.startswith("[Contenido"):
                        ch.summary_status = 'skipped'
                    else:
                        ch.summary_status = 'done'

            if _quota_exceeded and book_obj:
                book_obj.status = 'error'
                book_obj.error_msg = ch.summary if ch else 'Cuota agotada'
                if job:
                    job.status = 'error'
            await db.commit()

        if quota_exceeded:
            return

        if i < len(chapter_ids) - 1:
            pause = 10 if 'gemini' in (settings.AI_MODEL or '').lower() else 15
            print(f"Phase3: pausa {pause}s antes del siguiente capítulo")
            await _asyncio.sleep(pause)

    # ── Paso 3: marcar completado ──
    async for db in get_user_db(user_id):
        job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
        if job:
            job.status = 'done'
            job.progress = 100
            job.detail = f"Resúmenes completados ({total} capítulos)"
        await db.commit()

    print(f"Phase3 completada: {total} capítulos")
    if chain_next:
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
                book.podcast_audio_path = None

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
            found_isbn = metadata.get("isbn")
            if found_isbn and found_isbn != book.isbn:
                dup = await db.execute(
                    select(Book).where(
                        Book.isbn == found_isbn,
                        Book.id != book_id
                    )
                )
                if dup.scalar_one_or_none():
                    await db.delete(book)
                    await db.commit()
                    print(f"Shell duplicado eliminado: {book.title} (ISBN {found_isbn} ya existe)")
                    return

            # Comprobar duplicado por título normalizado + autor (por si el ISBN llegó después)
            if metadata.get("title") or book.title:
                check_title = metadata.get("title") or book.title
                check_author = metadata.get("author") or book.author
                norm_check = _normalize_title(check_title)
                candidates = await db.execute(
                    select(Book).where(
                        Book.id != book_id,
                        Book.author == check_author if check_author else True,
                    )
                )
                for candidate in candidates.scalars().all():
                    if _normalize_title(candidate.title or "") == norm_check:
                        # Si el candidato ya está analizado o es más completo, eliminar este shell
                        if candidate.phase3_done or candidate.status not in ("shell", "shell_error"):
                            await db.delete(book)
                            await db.commit()
                            print(f"Shell duplicado por título eliminado: {check_title}")
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
            from app.services.book_identifier import (
                get_author_bio_in_spanish, get_author_bibliography
            )

            # 1. Obtener bio en español
            new_bio = await get_author_bio_in_spanish(author_name)
            print(f"Bio final para '{author_name}': {repr(new_bio[:100]) if new_bio else 'no encontrada'}")

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

            # 4. Construir índice de libros ya existentes en BD para este autor
            import uuid, re as _re
            created = 0

            all_books_result = await db.execute(
                select(Book.title, Book.isbn, Book.status, Book.phase3_done)
                .where(Book.author == author_name)
            )
            existing_books = all_books_result.all()

            # Índices para deduplicación
            existing_norm_titles = {_normalize_title(b.title) for b in existing_books}
            existing_isbns = {b.isbn for b in existing_books if b.isbn}
            existing_isbn_bases = {_isbn_base(b.isbn) for b in existing_books if b.isbn}
            # Títulos de libros que ya tienen archivo o están analizados
            analyzed_norm_titles = {
                _normalize_title(b.title) for b in existing_books
                if b.phase3_done or b.status not in ("shell", "shell_error")
            }
            analyzed_isbns = {
                b.isbn for b in existing_books
                if b.isbn and (b.phase3_done or b.status not in ("shell", "shell_error"))
            }

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

                norm = _normalize_title(b_title)
                b_isbn_base = _isbn_base(b_isbn or "")

                # ── Deduplicación rigurosa ──

                # 1. ISBN exacto ya existe → skip
                if b_isbn and b_isbn in existing_isbns:
                    continue

                # 2. ISBN base ya existe (misma obra, edición diferente) → skip
                if b_isbn_base and b_isbn_base in existing_isbn_bases:
                    continue

                # 3. Título normalizado ya existe → skip
                if norm in existing_norm_titles:
                    # Si el libro existente ya está analizado, actualizar su status
                    # para que no aparezca como "Solo ficha" en la bibliografía
                    # (ya se maneja en el frontend con phase3_done)
                    continue

                # Crear ficha shell
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

                # Actualizar índices locales para evitar duplicados dentro del mismo lote
                existing_norm_titles.add(norm)
                if b_isbn:
                    existing_isbns.add(b_isbn)
                if b_isbn_base:
                    existing_isbn_bases.add(b_isbn_base)

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

            await db.execute(delete(Character).where(Character.book_id == book_id))
            await db.commit()

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
