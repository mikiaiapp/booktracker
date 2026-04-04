"""
Async tasks for book processing:
- Phase 1: Identify book, scrape metadata & cover
- Phase 2: Detect parts & chapters from file
- Phase 3: AI summaries per chapter
- Phase 4: Characters + Global Summary + Mindmap  (antes llamado "3b")
- Phase 5: Podcast script + TTS audio

Política de reintentos: cada fase reintenta hasta PHASE_MAX_RETRIES veces
con PHASE_RETRY_DELAY segundos entre intentos antes de marcar error (rojo).

Encadenamiento inteligente: al finalizar cualquier fase —automática o manual—
la siguiente solo se lanza si aún no tiene datos. Si ya tiene datos, se detiene.
"""
import asyncio
import os
from app.workers.celery_app import celery_app

# ── Política de reintentos ────────────────────────────────────────────────────
PHASE_MAX_RETRIES = 5   # intentos extra (total = 1 + 5 = 6)
PHASE_RETRY_DELAY = 20  # segundos entre reintentos


def _format_quota_error(e: Exception) -> str:
    msg = str(e)
    if msg.startswith("QUOTA_EXCEEDED:"):
        parts = msg.split(":")
        hours = parts[1] if len(parts) > 1 else "?"
        mins  = parts[2] if len(parts) > 2 else "?"
        return f"Cuota de IA agotada. Se restablece en {hours}h {mins}min (medianoche UTC)."
    return msg


def run_async(coro):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


# ── Normalización de nombres de autor ────────────────────────────────────────

def _normalize_author_words(name: str) -> set:
    import re
    stop = {'i', 'y', 'de', 'del', 'la', 'el', 'von', 'van', 'di', 'da', 'du', 'le'}
    clean = re.sub(r'[^\w\s]', ' ', name.strip(), flags=re.UNICODE)
    return {w.lower() for w in clean.split() if w.lower() not in stop and len(w) > 1}


def _is_name_inversion(name_a: str, name_b: str) -> bool:
    import re
    def clean(s): return re.sub(r'[^\w\s]', ' ', s.strip(), flags=re.UNICODE).lower().split()
    words_a = set(clean(name_a))
    words_b = set(clean(name_b))
    return len(words_a) >= 2 and words_a == words_b


def _normalize_title(t: str) -> str:
    import re
    t = t.lower().strip()
    t = t.split(':')[0].split(' / ')[0]
    t = re.sub(r'\s*\([^)]*\)', '', t)
    t = re.sub(r'\b(novela|roman|novel|libro)\b', '', t, flags=re.IGNORECASE)
    t = re.sub(r'^(el|la|los|las|un|una|the|a|an|le|les|der|die|das)\s+', '', t.strip())
    return re.sub(r'\s+', ' ', t).strip()


def _isbn_base(isbn: str) -> str:
    digits = ''.join(c for c in (isbn or '') if c.isdigit())
    return digits[:9] if len(digits) >= 9 else digits


# ── Helpers de encadenamiento inteligente ─────────────────────────────────────

async def _phase4_is_empty(db, book_id: str) -> bool:
    """True si la Fase 4 aun no tiene datos."""
    from app.models.book import Book, Character
    from sqlalchemy import select
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        return False
    if book.global_summary or book.mindmap_data:
        return False
    char_check = await db.execute(
        select(Character.id).where(Character.book_id == book_id).limit(1)
    )
    return char_check.scalar_one_or_none() is None


async def _podcast_is_empty(db, book_id: str) -> bool:
    """True si el podcast aun no tiene datos."""
    from app.models.book import Book
    from sqlalchemy import select
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    return book is not None and not book.podcast_script


# ── Phase 1: Book identification ──────────────────────────────────────────────

@celery_app.task(bind=True, name="process_book_phase1")
def process_book_phase1(self, user_id: str, book_id: str):
    return run_async(_phase1(user_id, book_id))


async def _phase1(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, AnalysisJob
    from app.services.book_identifier import identify_book
    from app.workers.queue_manager import update_progress, on_done
    from sqlalchemy import select
    import traceback

    update_progress(user_id, book_id, "phase1", 10, "Identificando libro...")

    async for db in get_user_db(user_id):
        result = await db.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        if not book:
            return

        original_author = book.author

        job = AnalysisJob(book_id=book_id, phase=1, status="running")
        db.add(job)
        await db.commit()

        from app.core.config import settings
        covers_dir = os.path.join(settings.COVERS_DIR, user_id)
        os.makedirs(covers_dir, exist_ok=True)

        # ── Bucle de reintentos ──
        for attempt in range(PHASE_MAX_RETRIES + 1):
            try:
                if attempt > 0:
                    await db.refresh(book)

                metadata = await identify_book(
                    book.file_path, book.file_type, book.title,
                    covers_dir=covers_dir, book_id=book_id
                )

                valid_fields = {
                    "title", "author", "isbn", "synopsis", "genre",
                    "language", "year", "pages", "author_bio",
                    "author_bibliography", "cover_url", "cover_local"
                }
                for k, v in metadata.items():
                    if k in valid_fields and v is not None and v != "":
                        try:
                            setattr(book, k, v)
                        except Exception as fe:
                            print(f"Phase1 error setting {k}: {fe}")

                new_author = book.author
                if new_author:
                    normalized = await _unify_author_name(db, new_author, book_id, original_author)
                    if normalized:
                        book.author = normalized
                        metadata["author"] = normalized

                duplicate_shell = await _find_duplicate_shell(
                    db, book_id, book.title, book.author, book.isbn
                )
                if duplicate_shell:
                    print(f"Phase1: libro '{book.title}' coincide con shell {duplicate_shell.id} — promoviendo")
                    duplicate_shell.file_path   = book.file_path
                    duplicate_shell.file_type   = book.file_type
                    duplicate_shell.file_size   = book.file_size
                    duplicate_shell.status      = "uploaded"
                    duplicate_shell.phase1_done = False
                    duplicate_shell.phase2_done = False
                    duplicate_shell.phase3_done = False
                    if not duplicate_shell.cover_local and book.cover_local:
                        duplicate_shell.cover_local = book.cover_local
                    if not duplicate_shell.cover_url and book.cover_url:
                        duplicate_shell.cover_url = book.cover_url
                    if not duplicate_shell.synopsis and book.synopsis:
                        duplicate_shell.synopsis = book.synopsis
                    if not duplicate_shell.isbn and book.isbn:
                        duplicate_shell.isbn = book.isbn
                    await db.delete(book)
                    await db.commit()
                    on_done(user_id, book_id)
                    process_book_phase1.delay(user_id, duplicate_shell.id)
                    return

                book.phase1_done = True
                book.status      = "identified"
                job.status       = "done"
                job.progress     = 100
                await db.commit()
                break  # exito

            except Exception as e:
                msg      = str(e)
                is_quota = "QUOTA_EXCEEDED" in msg
                is_last  = attempt >= PHASE_MAX_RETRIES

                if is_quota or is_last:
                    try:
                        await db.rollback()
                        book.status    = "quota_exceeded" if is_quota else "error"
                        book.error_msg = _format_quota_error(e) if is_quota else traceback.format_exc()
                        job.status     = "error"
                        await db.commit()
                    except Exception:
                        pass
                    on_done(user_id, book_id)
                    raise

                print(f"[Phase1] Intento {attempt+1}/{PHASE_MAX_RETRIES+1}: {msg[:100]}. Reintentando en {PHASE_RETRY_DELAY}s")
                try:
                    await db.rollback()
                except Exception:
                    pass
                await asyncio.sleep(PHASE_RETRY_DELAY)

        # Exito: encadenar
        if book.author:
            reidentify_author_task.delay(user_id, book.author)
        update_progress(user_id, book_id, "phase2", 25, "Analizando estructura...")
        process_book_phase2.delay(user_id, book_id)


async def _find_duplicate_shell(db, current_book_id, title, author, isbn):
    from app.models.book import Book
    from sqlalchemy import select

    result = await db.execute(
        select(Book).where(
            Book.status.in_(["shell", "shell_error"]),
            Book.id != current_book_id,
        )
    )
    shells = result.scalars().all()

    norm_title   = _normalize_title(title or "")
    isbn_base    = _isbn_base(isbn or "")
    author_words = _normalize_author_words(author or "")

    for shell in shells:
        if shell.author and author:
            shell_words  = _normalize_author_words(shell.author)
            author_match = (
                shell.author == author or
                _is_name_inversion(shell.author, author) or
                (len(shell_words & author_words) >= 2)
            )
            if not author_match:
                continue

        if isbn and shell.isbn and shell.isbn == isbn:
            return shell
        if isbn_base and shell.isbn and _isbn_base(shell.isbn) == isbn_base:
            return shell
        if norm_title and shell.title and _normalize_title(shell.title) == norm_title:
            return shell

    return None


async def _unify_author_name(db, author_name, book_id, original_author=None):
    from app.models.book import Book
    from sqlalchemy import select, func

    my_words   = _normalize_author_words(author_name)
    orig_words = _normalize_author_words(original_author) if original_author else set()
    if not my_words:
        return None

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
        other_name  = row.author
        other_words = _normalize_author_words(other_name)
        if not other_words:
            continue

        if _is_name_inversion(author_name, other_name):
            best_match = (other_name, row.cnt)
            best_score = 999
            break
        if original_author and _is_name_inversion(original_author, other_name):
            best_match = (other_name, row.cnt)
            best_score = 999
            break

        common_new  = my_words & other_words
        common_orig = orig_words & other_words if orig_words else set()
        common      = common_new if len(common_new) >= len(common_orig) else common_orig
        search_w    = my_words if len(common_new) >= len(common_orig) else orig_words

        min_common = 1 if (len(search_w) == 1 and len(other_words) == 1) else 2
        jaccard    = len(common) / len(search_w | other_words) if (search_w | other_words) else 0
        score      = len(common) * jaccard
        if len(common) >= min_common and jaccard >= 0.4 and score > best_score:
            best_score = score
            best_match = (other_name, row.cnt)

    if not best_match:
        return None

    other_name, other_count = best_match
    result2 = await db.execute(
        select(func.count(Book.id))
        .where(Book.author.in_(exclude_names), Book.id != book_id)
    )
    current_count = result2.scalar() or 0

    if current_count > other_count:
        canonical, redundant = author_name, other_name
    elif other_count > current_count:
        canonical, redundant = other_name, author_name
    else:
        canonical = author_name if len(author_name) >= len(other_name) else other_name
        redundant = other_name if canonical == author_name else author_name

    print(f"Unificando autor: '{redundant}' -> '{canonical}'")
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
    from app.workers.queue_manager import update_progress, on_done
    from sqlalchemy import select, delete
    import traceback

    async for db in get_user_db(user_id):
        result = await db.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        if not book:
            return

        job = AnalysisJob(book_id=book_id, phase=2, status="running")
        db.add(job)
        await db.commit()

        for attempt in range(PHASE_MAX_RETRIES + 1):
            try:
                structure = await parse_book_structure(book.file_path, book.file_type)

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
                        raw_text=chap.get("text", "")[:50000],
                    )
                    db.add(c)

                book.phase2_done = True
                book.status      = "structured"
                job.status       = "done"
                job.progress     = 100
                await db.commit()
                break  # exito

            except Exception as e:
                is_last = attempt >= PHASE_MAX_RETRIES
                if is_last:
                    try:
                        await db.rollback()
                        book.status    = "error"
                        book.error_msg = traceback.format_exc()
                        job.status     = "error"
                        await db.commit()
                    except Exception:
                        pass
                    on_done(user_id, book_id)
                    raise

                print(f"[Phase2] Intento {attempt+1}/{PHASE_MAX_RETRIES+1}: {str(e)[:100]}. Reintentando en {PHASE_RETRY_DELAY}s")
                try:
                    await db.rollback()
                except Exception:
                    pass
                await asyncio.sleep(PHASE_RETRY_DELAY)

        update_progress(user_id, book_id, "phase3", 40, "Resumiendo capitulos...")
        process_book_phase3.delay(user_id, book_id)


# ── Phase 3: AI summaries ─────────────────────────────────────────────────────

@celery_app.task(bind=True, name="process_book_phase3")
def process_book_phase3(self, user_id: str, book_id: str):
    return run_async(_phase3(user_id, book_id))


async def _phase3(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter, AnalysisJob
    from app.services.ai_analyzer import summarize_chapter
    from app.workers.queue_manager import update_progress, on_done
    from app.core.config import settings
    from sqlalchemy import select

    book_title  = ""
    book_author = None
    total       = 0
    job_id      = None
    chapter_ids = []

    async for db in get_user_db(user_id):
        book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
        if not book:
            return
        book_title  = book.title
        book_author = book.author
        chaps = (await db.execute(
            select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order)
        )).scalars().all()
        total = len(chaps)
        for ch in chaps:
            if ch.summary_status == 'processing':
                ch.summary_status = 'pending'
        job = AnalysisJob(book_id=book_id, phase=3, status="running",
                          detail=f"Iniciando resumenes ({total} capitulos)")
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
    print(f"Phase3: {len(chapter_ids)} capitulos pendientes de {total} total")

    for i, (ch_id, ch_title, ch_text) in enumerate(chapter_ids):
        global_num = done_count + i + 1

        async for db in get_user_db(user_id):
            ch  = (await db.execute(select(Chapter).where(Chapter.id == ch_id))).scalar_one_or_none()
            job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
            if ch:
                ch.summary_status = 'processing'
            if job:
                job.progress = int(global_num / total * 100)
                job.detail   = f"Resumiendo capitulo {global_num}/{total}: {ch_title}"
            await db.commit()

        pct = 40 + int((global_num / max(total, 1)) * 40)
        update_progress(user_id, book_id, "phase3", pct, f"Cap. {global_num}/{total}: {ch_title}")

        summary_data   = None
        error_msg      = None
        quota_exceeded = False

        for attempt in range(PHASE_MAX_RETRIES + 1):
            try:
                summary_data = await summarize_chapter(ch_title, ch_text, book_title, book_author)
                error_msg = None
                print(f"Phase3: capitulo {global_num} resumido OK (intento {attempt+1})")
                break
            except Exception as e:
                error_msg = str(e)
                if "QUOTA_EXCEEDED" in error_msg or "rate limit" in error_msg.lower():
                    quota_exceeded = True
                    break
                if attempt < PHASE_MAX_RETRIES:
                    print(f"Phase3: error intento {attempt+1}/{PHASE_MAX_RETRIES+1} en '{ch_title}': {error_msg[:80]}. Reintentando en {PHASE_RETRY_DELAY}s")
                    await asyncio.sleep(PHASE_RETRY_DELAY)

        _summary_data   = summary_data
        _error_msg      = error_msg
        _quota_exceeded = quota_exceeded

        async for db in get_user_db(user_id):
            ch       = (await db.execute(select(Chapter).where(Chapter.id == ch_id))).scalar_one_or_none()
            book_obj = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
            job      = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()

            if ch:
                if _quota_exceeded:
                    ch.summary_status = 'quota_exceeded'
                    ch.summary = _format_quota_error(Exception(_error_msg)) if _error_msg else 'Cuota agotada'
                elif _error_msg:
                    ch.summary_status = 'error'
                    ch.summary = f"Error: {_error_msg[:200]}"
                elif _summary_data:
                    ch.summary    = _summary_data.get("summary", "")
                    ch.key_events = _summary_data.get("key_events", [])
                    ch.summary_status = 'skipped' if (ch.summary and ch.summary.startswith("[Contenido")) else 'done'

            if _quota_exceeded and book_obj:
                book_obj.status    = 'quota_exceeded'
                book_obj.error_msg = ch.summary if ch else 'Cuota agotada'
                if job:
                    job.status = 'error'
            await db.commit()

        if quota_exceeded:
            on_done(user_id, book_id)
            return

        if i < len(chapter_ids) - 1:
            pause = 10 if 'gemini' in (settings.AI_MODEL or '').lower() else 15
            await asyncio.sleep(pause)

    # Marcar Phase 3 como completada
    async for db in get_user_db(user_id):
        job = (await db.execute(select(AnalysisJob).where(AnalysisJob.id == job_id))).scalar_one_or_none()
        if job:
            job.status   = 'done'
            job.progress = 100
            job.detail   = f"Resumenes completados ({total} capitulos)"
        await db.commit()

    print(f"Phase3 completada: {total} capitulos")

    # Encadenamiento inteligente: lanzar Phase 4 solo si esta vacia
    async for db in get_user_db(user_id):
        should_chain = await _phase4_is_empty(db, book_id)

    if should_chain:
        update_progress(user_id, book_id, "phase4", 82, "Analizando personajes y resumen global...")
        process_book_phase4.delay(user_id, book_id)
    else:
        print("Phase3: Phase4 ya tiene datos, encadenamiento detenido.")
        on_done(user_id, book_id)


# ── Phase 4: Characters + Global Summary + Mindmap ───────────────────────────
# (anteriormente llamada "Phase 3b")

@celery_app.task(bind=True, name="process_book_phase4")
def process_book_phase4(self, user_id: str, book_id: str):
    return run_async(_phase4(user_id, book_id))

# Alias de compatibilidad con nomenclatura anterior
process_phase3b_task = process_book_phase4


async def _phase4(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter, Character, AnalysisJob
    from app.services.ai_analyzer import analyze_characters, generate_global_summary, generate_mindmap
    from app.workers.queue_manager import update_progress, on_done
    from sqlalchemy import select, delete
    import traceback

    update_progress(user_id, book_id, "phase4", 82, "Analizando personajes y resumen global...")

    async for db in get_user_db(user_id):
        result = await db.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        if not book:
            return

        job = AnalysisJob(book_id=book_id, phase=4, status="running")
        db.add(job)
        await db.commit()

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
            try:
                book.status    = "error"
                book.error_msg = "No hay resumenes de capitulos disponibles para la Fase 4"
                job.status     = "error"
                await db.commit()
            except Exception:
                pass
            on_done(user_id, book_id)
            return

        for attempt in range(PHASE_MAX_RETRIES + 1):
            try:
                # ── Paso 1: Personajes ─────────────────────────────────────────────────
                update_progress(user_id, book_id, "phase4", 83, "Analizando personajes...")
                await db.execute(delete(Character).where(Character.book_id == book_id))
                await db.commit()

                try:
                    characters_data = await asyncio.wait_for(
                        analyze_characters(all_summaries, book.title), timeout=360
                    )
                except asyncio.TimeoutError:
                    print("[Phase4] TIMEOUT en analyze_characters (>360s), continuando sin personajes")
                    characters_data = []
                except Exception as char_err:
                    print(f"[Phase4] ERROR en analyze_characters: {char_err}")
                    characters_data = []

                for char_data in (characters_data or []):
                    char = Character(book_id=book_id, name=char_data["name"])
                    db.add(char)
                    for k, v in char_data.items():
                        if hasattr(char, k) and k != "name":
                            setattr(char, k, v)
                await db.commit()
                print(f"[Phase4] Personajes guardados: {len(characters_data or [])}")

                # ── Paso 2: Resumen global ─────────────────────────────────────────────
                update_progress(user_id, book_id, "phase4", 90, "Generando resumen global...")
                try:
                    book.global_summary = await asyncio.wait_for(
                        generate_global_summary(all_summaries, book.title, book.author), timeout=240
                    )
                except asyncio.TimeoutError:
                    print("[Phase4] TIMEOUT en generate_global_summary (>240s)")
                    book.global_summary = ""
                except Exception as gs_err:
                    print(f"[Phase4] ERROR en generate_global_summary: {gs_err}")
                    book.global_summary = ""
                await db.commit()
                print(f"[Phase4] Resumen global guardado: {len(book.global_summary or '')} chars")

                # ── Paso 3: Mapa mental ────────────────────────────────────────────────
                update_progress(user_id, book_id, "phase4", 95, "Generando mapa mental...")
                try:
                    book.mindmap_data = await asyncio.wait_for(
                        generate_mindmap(all_summaries, book.title), timeout=240
                    )
                except asyncio.TimeoutError:
                    print("[Phase4] TIMEOUT en generate_mindmap (>240s)")
                    book.mindmap_data = {"center": book.title, "branches": []}
                except Exception as mm_err:
                    print(f"[Phase4] ERROR en generate_mindmap: {mm_err}")
                    book.mindmap_data = {"center": book.title, "branches": []}
                await db.commit()
                print(f"[Phase4] Mapa mental guardado")

                update_progress(user_id, book_id, "phase4", 99, "Finalizando fase 4...")

                book.phase3_done = True
                book.status      = "analyzed"
                job.status       = "done"
                job.progress     = 100
                await db.commit()
                print(f"Phase4 completada para '{book.title}': {len(characters_data)} personajes")
                break  # exito

            except Exception as e:
                msg      = str(e)
                is_quota = "QUOTA_EXCEEDED" in msg
                is_last  = attempt >= PHASE_MAX_RETRIES

                if is_quota or is_last:
                    try:
                        await db.rollback()
                        book.status    = "quota_exceeded" if is_quota else "error"
                        book.error_msg = _format_quota_error(e) if is_quota else traceback.format_exc()
                        job.status     = "error"
                        await db.commit()
                    except Exception:
                        pass
                    on_done(user_id, book_id)
                    raise

                print(f"[Phase4] Intento {attempt+1}/{PHASE_MAX_RETRIES+1}: {msg[:100]}. Reintentando en {PHASE_RETRY_DELAY}s")
                try:
                    await db.rollback()
                except Exception:
                    pass
                await asyncio.sleep(PHASE_RETRY_DELAY)

        # Encadenamiento inteligente: lanzar podcast solo si esta vacio
        async for db2 in get_user_db(user_id):
            should_chain = await _podcast_is_empty(db2, book_id)

        if should_chain:
            update_progress(user_id, book_id, "podcast", 92, "Generando podcast...")
            generate_podcast.delay(user_id, book_id)
        else:
            print("Phase4: podcast ya tiene datos, encadenamiento detenido.")
            on_done(user_id, book_id)


# ── Phase 5: Podcast ──────────────────────────────────────────────────────────

@celery_app.task(bind=True, name="generate_podcast")
def generate_podcast(self, user_id: str, book_id: str):
    return run_async(_podcast(user_id, book_id))


async def _podcast(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Character, AnalysisJob
    from app.services.ai_analyzer import generate_podcast_script
    from app.services.tts_service import synthesize_podcast
    from app.workers.queue_manager import update_progress, on_done
    from sqlalchemy import select
    import traceback

    update_progress(user_id, book_id, "podcast", 92, "Generando podcast...")

    async for db in get_user_db(user_id):
        result = await db.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        if not book:
            return

        job = AnalysisJob(book_id=book_id, phase=5, status="running")
        db.add(job)
        await db.commit()

        chars_result = await db.execute(select(Character).where(Character.book_id == book_id))
        characters   = chars_result.scalars().all()

        for attempt in range(PHASE_MAX_RETRIES + 1):
            try:
                script = await generate_podcast_script(
                    book.title, book.author, book.global_summary,
                    [{"name": c.name, "personality": c.personality, "arc": c.arc} for c in characters]
                )
                book.podcast_script = script

                from app.core.config import settings
                audio_dir  = os.path.join(settings.AUDIO_DIR, user_id)
                os.makedirs(audio_dir, exist_ok=True)
                audio_path = os.path.join(audio_dir, f"{book_id}.mp3")

                try:
                    await synthesize_podcast(script, audio_path)
                    book.podcast_audio_path = audio_path
                except Exception as audio_err:
                    print(f"TTS audio failed (script saved anyway): {audio_err}")
                    book.podcast_audio_path = None

                book.status  = "complete"
                job.status   = "done"
                job.progress = 100
                await db.commit()
                print(f"Phase5 (Podcast) completada para '{book.title}'")
                break  # exito

            except Exception as e:
                msg      = str(e)
                is_quota = "QUOTA_EXCEEDED" in msg
                is_last  = attempt >= PHASE_MAX_RETRIES

                if is_quota or is_last:
                    try:
                        await db.rollback()
                        book.status    = "quota_exceeded" if is_quota else "error"
                        book.error_msg = _format_quota_error(e) if is_quota else traceback.format_exc()
                        job.status     = "error"
                        await db.commit()
                    except Exception:
                        pass
                    on_done(user_id, book_id)
                    raise

                print(f"[Podcast] Intento {attempt+1}/{PHASE_MAX_RETRIES+1}: {msg[:100]}. Reintentando en {PHASE_RETRY_DELAY}s")
                try:
                    await db.rollback()
                except Exception:
                    pass
                await asyncio.sleep(PHASE_RETRY_DELAY)

        on_done(user_id, book_id)


# ── Resumen de capitulo individual ────────────────────────────────────────────

@celery_app.task(bind=True, name="summarize_chapter_task")
def summarize_chapter_task(self, user_id: str, book_id: str, chapter_id: str):
    return run_async(_summarize_single(user_id, book_id, chapter_id))


async def _summarize_single(user_id: str, book_id: str, chapter_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book, Chapter
    from app.services.ai_analyzer import summarize_chapter
    from sqlalchemy import select, func
    import traceback

    async for db in get_user_db(user_id):
        try:
            result  = await db.execute(select(Book).where(Book.id == book_id))
            book    = result.scalar_one_or_none()
            ch_res  = await db.execute(select(Chapter).where(Chapter.id == chapter_id))
            chapter = ch_res.scalar_one_or_none()
            if not chapter or not chapter.raw_text:
                return

            chapter.summary_status = "processing"
            await db.commit()

            last_err = None
            for attempt in range(PHASE_MAX_RETRIES + 1):
                try:
                    summary_data = await summarize_chapter(
                        chapter.title, chapter.raw_text,
                        book.title if book else "", book.author if book else None
                    )
                    chapter.summary        = summary_data.get("summary")
                    chapter.key_events     = summary_data.get("key_events", [])
                    chapter.summary_status = "done"
                    await db.commit()
                    last_err = None
                    break
                except Exception as e:
                    last_err = e
                    msg = str(e)
                    if "QUOTA_EXCEEDED" in msg:
                        chapter.summary_status = "quota_exceeded"
                        chapter.summary = _format_quota_error(e)
                        await db.commit()
                        return
                    if attempt < PHASE_MAX_RETRIES:
                        print(f"[ChapterTask] Intento {attempt+1}/{PHASE_MAX_RETRIES+1}: {msg[:80]}. Reintentando en {PHASE_RETRY_DELAY}s")
                        await asyncio.sleep(PHASE_RETRY_DELAY)

            if last_err:
                chapter.summary_status = "error"
                await db.commit()
                raise last_err

        except Exception as e:
            try:
                chapter.summary_status = "error"
                await db.commit()
            except Exception:
                pass
            raise

    # Encadenamiento inteligente: si todos los capitulos estan listos y Phase4 vacia
    async for db in get_user_db(user_id):
        from app.models.book import Chapter as Ch
        from sqlalchemy import select as sel, func as sqf

        total_ch = (await db.execute(
            sel(sqf.count(Ch.id)).where(Ch.book_id == book_id)
        )).scalar() or 0
        done_ch = (await db.execute(
            sel(sqf.count(Ch.id)).where(
                Ch.book_id == book_id, Ch.summary_status == "done"
            )
        )).scalar() or 0

        if total_ch > 0 and done_ch >= total_ch:
            should_chain = await _phase4_is_empty(db, book_id)
            if should_chain:
                print(f"[ChapterTask] Todos los capitulos listos. Encadenando a Phase 4.")
                from app.workers.queue_manager import update_progress
                update_progress(user_id, book_id, "phase4", 82, "Analizando personajes y resumen global...")
                process_book_phase4.delay(user_id, book_id)


# ── Ficha shell: solo metadatos web ──────────────────────────────────────────

@celery_app.task(bind=True, name="fetch_shell_metadata")
def fetch_shell_metadata(self, user_id: str, book_id: str):
    return run_async(_fetch_shell(user_id, book_id))


async def _fetch_shell(user_id: str, book_id: str):
    from app.core.database import get_user_db
    from app.models.book import Book
    from app.services.book_identifier import search_book_metadata, download_cover
    from sqlalchemy import select
    import traceback
    from app.core.config import settings

    async for db in get_user_db(user_id):
        try:
            result = await db.execute(select(Book).where(Book.id == book_id))
            book = result.scalar_one_or_none()
            if not book:
                return

            metadata = await search_book_metadata(book.title, book.author)

            found_isbn = metadata.get("isbn")
            if found_isbn and found_isbn != book.isbn:
                dup = await db.execute(select(Book).where(Book.isbn == found_isbn, Book.id != book_id))
                if dup.scalar_one_or_none():
                    await db.delete(book)
                    await db.commit()
                    return

            field_map = {
                "title": str, "author": str, "isbn": str,
                "synopsis": str, "genre": str, "language": str,
                "year": int, "pages": int,
                "author_bio": str, "author_bibliography": list,
                "cover_url": str,
            }
            for field in field_map:
                val = metadata.get(field)
                if val is not None and val != "":
                    try:
                        setattr(book, field, val)
                    except Exception as fe:
                        print(f"Error setting {field}: {fe}")

            cover_url_to_use = book.cover_url or metadata.get("cover_url")
            if cover_url_to_use and not book.cover_local:
                cover_dir   = os.path.join(settings.COVERS_DIR, user_id)
                local_cover = await download_cover(cover_url_to_use, cover_dir, book_id)
                if local_cover:
                    book.cover_local = local_cover

            book.phase1_done = True
            book.status = "shell"
            await db.commit()

        except Exception as e:
            try:
                book.status    = "shell_error"
                book.error_msg = traceback.format_exc()
                await db.commit()
            except Exception:
                pass


# ── Reidentificar autor ───────────────────────────────────────────────────────

@celery_app.task(bind=True, name="reidentify_author_task")
def reidentify_author_task(self, user_id: str, author_name: str):
    return run_async(_reidentify_author(user_id, author_name))


async def _reidentify_author(user_id: str, author_name: str):
    from app.core.database import get_user_db
    from app.models.book import Book
    from app.services.book_identifier import get_author_bio_in_spanish, get_author_bibliography
    from sqlalchemy import select, or_
    import traceback, uuid

    async for db in get_user_db(user_id):
        try:
            new_bio    = await get_author_bio_in_spanish(author_name)
            new_biblio = await get_author_bibliography(author_name)

            # Ordenar bibliografía: más recientes primero
            if new_biblio:
                new_biblio = sorted(
                    new_biblio,
                    key=lambda x: x.get("year") or 0,
                    reverse=True
                )

            result = await db.execute(select(Book).where(Book.author == author_name))
            books  = result.scalars().all()
            for book in books:
                if new_bio:
                    book.author_bio = new_bio
                if new_biblio:
                    book.author_bibliography = new_biblio
            await db.commit()

            all_books_result = await db.execute(
                select(Book.title, Book.isbn, Book.status, Book.phase3_done)
                .where(Book.author == author_name)
            )
            existing_books = all_books_result.all()

            existing_norm_titles = {_normalize_title(b.title) for b in existing_books}
            existing_isbns       = {b.isbn for b in existing_books if b.isbn}
            existing_isbn_bases  = {_isbn_base(b.isbn) for b in existing_books if b.isbn}

            created = 0
            for item in (new_biblio or []):
                if not isinstance(item, dict):
                    continue

                b_title     = item.get("title")
                b_isbn      = item.get("isbn")
                b_year      = item.get("year")
                b_cover_url = item.get("cover_url")
                b_synopsis  = item.get("synopsis")

                if not b_title:
                    continue

                norm        = _normalize_title(b_title)
                b_isbn_base = _isbn_base(b_isbn or "")

                if b_isbn and b_isbn in existing_isbns:
                    continue
                if b_isbn_base and b_isbn_base in existing_isbn_bases:
                    continue
                if norm in existing_norm_titles:
                    continue

                book_id_new = str(uuid.uuid4())
                shell = Book(
                    id=book_id_new, title=b_title, author=author_name,
                    isbn=b_isbn, year=b_year, synopsis=b_synopsis,
                    cover_url=b_cover_url,
                    author_bio=new_bio, author_bibliography=new_biblio,
                    status="shell", phase1_done=False,
                )
                db.add(shell)
                await db.commit()

                existing_norm_titles.add(norm)
                if b_isbn:
                    existing_isbns.add(b_isbn)
                if b_isbn_base:
                    existing_isbn_bases.add(b_isbn_base)

                fetch_shell_metadata.delay(user_id, book_id_new)
                created += 1
                print(f"Shell creado: {b_title} ({b_isbn}) - año: {b_year}")

            result2 = await db.execute(
                select(Book).where(
                    Book.author == author_name,
                    Book.status.in_(["shell", "shell_error"]),
                    or_(Book.cover_local.is_(None), Book.synopsis.is_(None))
                )
            )
            for shell in result2.scalars().all():
                fetch_shell_metadata.delay(user_id, shell.id)

            print(f"Autor '{author_name}' reidentificado. {created} fichas nuevas.")

        except Exception as e:
            print(f"Error reidentifying author {author_name}: {traceback.format_exc()}")
            raise


# ── Reanalizar personajes ─────────────────────────────────────────────────────

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
                print(f"No hay resumenes disponibles para {book.title}")
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
            print(f"Personajes reanalizados para '{book.title}': {len(characters_data)} personajes")

            # Encadenamiento inteligente: si podcast vacio, lanzar
            should_chain = await _podcast_is_empty(db, book_id)
            if should_chain:
                from app.workers.queue_manager import update_progress
                update_progress(user_id, book_id, "podcast", 92, "Generando podcast...")
                generate_podcast.delay(user_id, book_id)

        except Exception as e:
            print(f"Error reanalizando personajes: {traceback.format_exc()}")
            raise
