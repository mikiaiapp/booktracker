from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import os

from app.core.security import get_current_user
from app.core.database import get_user_db
from app.models.user import User
from app.models.book import Book, AnalysisJob, Chapter, Character

router = APIRouter()


async def get_db(current_user: User = Depends(get_current_user)):
    async for session in get_user_db(current_user.id):
        yield session


# ── Fase 1 ────────────────────────────────────────────────────

@router.post("/{book_id}/phase1")
async def trigger_phase1(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    from app.workers.tasks import process_book_phase1
    task = process_book_phase1.delay(current_user.id, book_id, False)
    book.task_id   = task.id
    book.status    = "identifying"
    book.phase1_done = False
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# ── Fase 2 ────────────────────────────────────────────────────

@router.post("/{book_id}/phase2")
async def trigger_phase2(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase1_done:
        raise HTTPException(400, "Phase 1 not complete")

    from app.workers.tasks import process_book_phase2
    task = process_book_phase2.delay(current_user.id, book_id, False)
    book.task_id   = task.id
    book.status    = "analyzing_structure"
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# ── Fase 3: resúmenes de capítulos ───────────────────────────
# Al terminar, encadena a Fase 4 solo si está vacía (smart chaining integrado en tasks.py)

@router.post("/{book_id}/phase3")
async def trigger_phase3(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase2_done:
        raise HTTPException(400, "Phase 2 not complete")

    # Resetear capitulos a pendiente para que se rerresumen
    await db.execute(
        select(Chapter).where(Chapter.book_id == book_id)
    )
    chaps = (await db.execute(
        select(Chapter).where(Chapter.book_id == book_id)
    )).scalars().all()
    for ch in chaps:
        if ch.summary_status not in ("done", "skipped"):
            ch.summary_status = "pending"

    from app.workers.tasks import process_book_phase3
    task = process_book_phase3.delay(current_user.id, book_id)
    book.task_id   = task.id
    book.status    = "summarizing"
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# ── Fase 4: personajes + resumen global + mapa mental ─────────
# (antes llamada phase3b — endpoint legacy conservado por compatibilidad)
# Al terminar, encadena a Fase 5 (podcast) solo si está vacía.

@router.post("/{book_id}/phase4")
async def trigger_phase4(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase2_done:
        raise HTTPException(400, "Phase 2 not complete")

    from app.workers.tasks import process_book_phase4
    task = process_book_phase4.delay(current_user.id, book_id)
    book.task_id   = task.id
    book.status    = "summarizing"
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# Endpoint legacy "phase3b" — redirige a phase4
@router.post("/{book_id}/phase3b")
async def trigger_phase3b(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Alias de /phase4 para compatibilidad con versiones anteriores."""
    return await trigger_phase4(book_id, current_user, db)


# ── Resumen de un capítulo individual ────────────────────────
# Si al terminar todos los capítulos están listos y Fase 4 está vacía, la encadena.

@router.post("/{book_id}/chapter/{chapter_id}/summarize")
async def summarize_single_chapter(
    book_id: str,
    chapter_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase2_done:
        raise HTTPException(400, "Phase 2 not complete")

    ch_result = await db.execute(
        select(Chapter).where(Chapter.id == chapter_id, Chapter.book_id == book_id)
    )
    chapter = ch_result.scalar_one_or_none()
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if not chapter.raw_text:
        raise HTTPException(400, "Chapter has no text to summarize")

    from app.workers.tasks import summarize_chapter_task
    task = summarize_chapter_task.delay(current_user.id, book_id, chapter_id)
    chapter.summary_status = "processing"
    await db.commit()
    return {"task_id": task.id, "chapter_id": chapter_id}


# ── Fase 5: Podcast ────────────────────────────────────────────

# ── Fase 5: Mapa Mental ───────────────────────────────────────

@router.post("/{book_id}/phase5")
async def trigger_phase5(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase2_done:
        raise HTTPException(400, "Phase 2 not complete")

    from app.workers.tasks import process_book_phase5
    task = process_book_phase5.delay(current_user.id, book_id)
    book.task_id   = task.id
    book.status    = "summarizing"
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# ── Fase 6: Podcast ───────────────────────────────────────────

@router.post("/{book_id}/podcast")
async def trigger_podcast(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase3_done:
        raise HTTPException(400, "Phase 3/4 not complete")

    from app.workers.tasks import generate_podcast
    task = generate_podcast.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status  = "generating_podcast"
    await db.commit()
    return {"task_id": task.id}


# ── Status ────────────────────────────────────────────────────

@router.get("/{book_id}/status")
async def get_status(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    jobs_result = await db.execute(
        select(AnalysisJob).where(AnalysisJob.book_id == book_id).order_by(AnalysisJob.created_at.desc())
    )
    jobs = jobs_result.scalars().all()

    ch_result = await db.execute(select(Chapter).where(Chapter.book_id == book_id))
    chapters  = ch_result.scalars().all()
    total_ch  = len(chapters)
    done_ch   = sum(1 for c in chapters if c.summary_status == "done")

    chapters_summarized = total_ch > 0 and done_ch == total_ch

    return {
        "status":               book.status,
        "phase1_done":          book.phase1_done,
        "phase2_done":          book.phase2_done,
        "phase3_done":          book.phase3_done,
        "chapters_summarized":  chapters_summarized,
        "has_global_summary":   bool(book.global_summary),
        "has_mindmap":          bool(book.mindmap_data),
        "podcast_done":         book.status == "complete" and bool(book.podcast_script),
        "error_msg":            book.error_msg,
        "chapters_total":       total_ch,
        "chapters_done":        done_ch,
        "podcast_audio_path":   book.podcast_audio_path,
        "podcast_script":       bool(book.podcast_script),
        "jobs": [
            {
                "phase":    j.phase,
                "status":   j.status,
                "progress": j.progress,
                "detail":   j.detail,
            }
            for j in jobs
        ],
    }


# ── Audio podcast ─────────────────────────────────────────────

@router.get("/{book_id}/podcast/audio")
async def get_podcast_audio(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book or not book.podcast_audio_path:
        raise HTTPException(404, "Podcast not available")
    return FileResponse(book.podcast_audio_path, media_type="audio/mpeg")


# ── Descarga del archivo original ────────────────────────────

@router.get("/{book_id}/download")
async def download_book_file(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.file_path or not os.path.exists(book.file_path):
        raise HTTPException(404, "File not available")

    filename   = f"{book.title}.{book.file_type or 'pdf'}".replace("/", "_")
    media_type = "application/epub+zip" if book.file_type == "epub" else "application/pdf"
    return FileResponse(book.file_path, media_type=media_type, filename=filename)


# ── Fusionar autores ──────────────────────────────────────────

@router.post("/authors/merge")
async def merge_authors(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body   = await request.json()
    source = body.get("source", "").strip()
    target = body.get("target", "").strip()
    if not source or not target:
        raise HTTPException(400, "source y target son obligatorios")
    if source == target:
        raise HTTPException(400, "source y target deben ser distintos")

    result = await db.execute(select(Book).where(Book.author == source))
    books  = result.scalars().all()
    if not books:
        raise HTTPException(404, f"No se encontraron libros para '{source}'")

    target_result = await db.execute(select(Book).where(Book.author == target).limit(1))
    target_book   = target_result.scalar_one_or_none()

    for book in books:
        book.author = target
        if target_book and not target_book.author_bio and book.author_bio:
            target_book.author_bio = book.author_bio
        if target_book and not target_book.author_bibliography and book.author_bibliography:
            target_book.author_bibliography = book.author_bibliography

    await db.commit()

    all_target  = await db.execute(select(Book).where(Book.author == target))
    merged_books = all_target.scalars().all()
    bio    = next((b.author_bio         for b in merged_books if b.author_bio),         None)
    biblio = next((b.author_bibliography for b in merged_books if b.author_bibliography), None)
    for b in merged_books:
        if bio    and not b.author_bio:         b.author_bio = bio
        if biblio and not b.author_bibliography: b.author_bibliography = biblio
    await db.commit()

    return {"merged": len(books), "target": target}


# ── Deduplicar globalmente (libros + autores) ─────────────────

@router.post("/authors/dedup-all")
async def dedup_all(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import re
    from sqlalchemy import func as sqlfunc

    authors_result = await db.execute(
        select(Book.author).where(Book.author.isnot(None)).group_by(Book.author)
    )
    all_authors = [r.author for r in authors_result.all()]
    books_deleted = 0

    for author_name in all_authors:
        result = await db.execute(
            select(Book).where(Book.author == author_name)
            .order_by(Book.phase3_done.desc(), Book.status)
        )
        books        = result.scalars().all()
        seen_isbns   = {}
        seen_titles  = {}
        for book in books:
            isbn_key  = book.isbn.strip() if book.isbn else None
            title_key = (book.title or "").lower().strip()
            if isbn_key and isbn_key in seen_isbns:
                if not book.phase3_done and book.status not in ("complete", "analyzed"):
                    await db.delete(book); books_deleted += 1; continue
            if not isbn_key and title_key in seen_titles:
                if not book.phase3_done and book.status not in ("complete", "analyzed"):
                    await db.delete(book); books_deleted += 1; continue
            if isbn_key:
                seen_isbns[isbn_key] = book.id
            seen_titles[title_key] = book.id

    await db.commit()

    def normalize(name: str) -> frozenset:
        stop  = {'i', 'y', 'de', 'del', 'la', 'el', 'von', 'van', 'di', 'da', 'du', 'le'}
        clean = re.sub(r'[^\w\s]', ' ', name.strip(), flags=re.UNICODE)
        return frozenset(w.lower() for w in clean.split() if w.lower() not in stop and len(w) > 1)

    counts_result = await db.execute(
        select(Book.author, sqlfunc.count(Book.id).label("cnt"))
        .where(Book.author.isnot(None))
        .group_by(Book.author)
    )
    author_counts = {r.author: r.cnt for r in counts_result.all()}
    author_names  = list(author_counts.keys())
    merged        = {}
    authors_merged = 0

    for i, a in enumerate(author_names):
        if a in merged: continue
        wa = normalize(a)
        if not wa: continue
        for b in author_names[i+1:]:
            if b in merged: continue
            wb = normalize(b)
            if not wb: continue
            common  = wa & wb
            jaccard = len(common) / len(wa | wb) if (wa | wb) else 0
            min_c   = 1 if (len(wa) == 1 and len(wb) == 1) else 2
            if len(common) >= min_c and jaccard >= 0.4:
                cnt_a = author_counts.get(a, 0)
                cnt_b = author_counts.get(b, 0)
                canonical, redundant = (a, b) if cnt_a >= cnt_b else (b, a)
                merged[redundant] = canonical
                red_result = await db.execute(select(Book).where(Book.author == redundant))
                can_result = await db.execute(select(Book).where(Book.author == canonical).limit(1))
                can_book   = can_result.scalar_one_or_none()
                bio    = can_book.author_bio         if can_book else None
                biblio = can_book.author_bibliography if can_book else None
                for bk in red_result.scalars().all():
                    bk.author = canonical
                    if bio    and not bk.author_bio:         bk.author_bio = bio
                    if biblio and not bk.author_bibliography: bk.author_bibliography = biblio
                authors_merged += 1

    await db.commit()
    return {"books_deleted": books_deleted, "authors_merged": authors_merged}


# ── Deduplicar libros de un autor ────────────────────────────

@router.post("/authors/dedup-books")
async def dedup_author_books(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body        = await request.json()
    author_name = body.get("author", "").strip()
    if not author_name:
        raise HTTPException(400, "author requerido")

    result = await db.execute(
        select(Book).where(Book.author == author_name).order_by(Book.phase3_done.desc(), Book.status)
    )
    books       = result.scalars().all()
    seen_isbns  = {}
    seen_titles = {}
    to_delete   = []

    for book in books:
        isbn_key  = book.isbn.strip() if book.isbn else None
        title_key = (book.title or "").lower().strip()
        if isbn_key:
            if isbn_key in seen_isbns:
                to_delete.append(book); continue
            seen_isbns[isbn_key] = book.id
        if title_key in seen_titles:
            to_delete.append(book); continue
        seen_titles[title_key] = book.id

    deleted = 0
    for book in to_delete:
        if not book.phase3_done and book.status not in ("complete", "analyzed"):
            await db.delete(book)
            deleted += 1

    await db.commit()
    return {"deleted": deleted, "author": author_name}


# ── Listar autores ────────────────────────────────────────────

@router.get("/authors/list")
async def list_authors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    analyzed_subq = (
        select(Book.author)
        .where(Book.phase3_done == True, Book.author.isnot(None))
        .distinct()
        .subquery()
    )
    result = await db.execute(
        select(Book.author, Book.author_bio, Book.author_bibliography,
               Book.id, Book.title, Book.cover_local, Book.cover_url, Book.year, Book.status,
               Book.phase3_done, Book.isbn, Book.synopsis)
        .where(
            Book.author.isnot(None),
            Book.author.in_(select(analyzed_subq.c.author))
        )
        .order_by(Book.author, Book.phase3_done.desc(), Book.status)
    )
    rows = result.all()

    authors: dict = {}
    for row in rows:
        author = row.author
        if not author:
            continue
        if author not in authors:
            authors[author] = {
                "name": author, "bio": None, "bibliography": [],
                "books": [], "_seen_isbns": set(), "_seen_titles": set(),
            }

        if not authors[author]["bio"] and row.author_bio:
            authors[author]["bio"] = row.author_bio

        if not authors[author]["bibliography"] and row.author_bibliography:
            raw_biblio = row.author_bibliography or []
            biblio = []
            for item in raw_biblio:
                if isinstance(item, str):
                    biblio.append({"title": item, "isbn": None, "year": None,
                                   "cover_url": None, "synopsis": None})
                elif isinstance(item, dict):
                    biblio.append({
                        "title":     item.get("title", ""),
                        "isbn":      item.get("isbn"),
                        "year":      item.get("year"),
                        "cover_url": item.get("cover_url"),
                        "synopsis":  item.get("synopsis"),
                    })
            # Ordenar: más recientes primero
            biblio.sort(key=lambda x: x.get("year") or 0, reverse=True)
            authors[author]["bibliography"] = biblio

        isbn_key  = row.isbn.strip() if row.isbn else None
        title_key = (row.title or "").lower().strip()
        seen_isbns  = authors[author]["_seen_isbns"]
        seen_titles = authors[author]["_seen_titles"]

        if isbn_key and isbn_key in seen_isbns:
            continue
        if not isbn_key and title_key in seen_titles:
            continue

        if isbn_key:
            seen_isbns.add(isbn_key)
        seen_titles.add(title_key)

        authors[author]["books"].append({
            "id":         row.id,
            "title":      row.title,
            "cover_local": row.cover_local,
            "cover_url":  row.cover_url,
            "year":       row.year,
            "status":     row.status,
            "phase3_done": row.phase3_done,
            "isbn":       row.isbn,
            "synopsis":   row.synopsis,
        })

    for author_data in authors.values():
        author_data.pop("_seen_isbns", None)
        author_data.pop("_seen_titles", None)
        # Libros ordenados por año: más recientes primero
        author_data["books"].sort(key=lambda b: (b.get("year") or 0), reverse=True)

    return list(authors.values())


# ── Borrar autor ──────────────────────────────────────────────

@router.delete("/authors/delete")
async def delete_author(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body        = await request.json()
    author_name = body.get("author", "").strip()
    if not author_name:
        raise HTTPException(400, "author requerido")

    analyzed = await db.execute(
        select(Book).where(Book.author == author_name, Book.phase3_done == True)
    )
    if analyzed.scalar_one_or_none():
        raise HTTPException(400, "No se puede borrar un autor con libros analizados")

    result = await db.execute(select(Book).where(Book.author == author_name))
    books  = result.scalars().all()

    deleted_books = 0
    for book in books:
        if book.file_path and os.path.exists(book.file_path):
            try: os.remove(book.file_path)
            except Exception: pass
        if book.cover_local and os.path.exists(book.cover_local):
            try: os.remove(book.cover_local)
            except Exception: pass
        await db.delete(book)
        deleted_books += 1

    await db.commit()
    return {"ok": True, "author": author_name, "deleted_books": deleted_books}


# ── Reidentificar autor ───────────────────────────────────────

@router.post("/authors/reidentify")
async def reidentify_author(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    body        = await request.json()
    author_name = body.get("author")
    if not author_name:
        raise HTTPException(400, "author required")

    result = await db.execute(select(Book).where(Book.author == author_name))
    books  = result.scalars().all()
    if not books:
        raise HTTPException(404, "Author not found")

    from app.workers.tasks import reidentify_author_task
    task = reidentify_author_task.delay(current_user.id, author_name)
    return {"task_id": task.id, "status": "processing"}


# ── Estado de tarea Celery ────────────────────────────────────

@router.get("/tasks/{task_id}/status")
async def get_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    from app.workers.celery_app import celery_app
    result = celery_app.AsyncResult(task_id)
    state  = result.state
    return {
        "task_id": task_id,
        "state":   state,
        "done":    state in ("SUCCESS", "FAILURE"),
        "success": state == "SUCCESS",
    }


# ── Reidentificar libro individual ────────────────────────────

@router.post("/{book_id}/reidentify-book")
async def reidentify_book(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    book.status      = "shell"
    book.phase1_done = False
    await db.commit()

    from app.workers.tasks import fetch_shell_metadata
    fetch_shell_metadata.delay(current_user.id, book_id)
    return {"status": "updating"}


# ── Reanalizar personajes ─────────────────────────────────────

@router.post("/{book_id}/reanalyze-characters")
async def reanalyze_characters(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if not book.phase3_done:
        raise HTTPException(400, "La fase 3/4 debe estar completa")

    from app.workers.tasks import reanalyze_characters_task
    task = reanalyze_characters_task.delay(current_user.id, book_id)
    return {"task_id": task.id, "status": "processing"}


# ── Reanalizar un personaje individual ───────────────────────

@router.post("/{book_id}/character/{character_id}/analyze")
async def analyze_single_character_endpoint(
    book_id: str,
    character_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    char = (await db.execute(
        select(Character).where(Character.id == character_id, Character.book_id == book_id)
    )).scalar_one_or_none()
    if not char:
        raise HTTPException(404, "Character not found")

    from app.workers.tasks import reanalyze_single_character_task
    task = reanalyze_single_character_task.delay(current_user.id, book_id, character_id)
    return {"task_id": task.id, "status": "processing"}


# ── Cancelar proceso en curso ─────────────────────────────────

@router.post("/{book_id}/cancel")
async def cancel_processing(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    if book.status in ("identifying",):
        book.status = "uploaded"
    elif book.status in ("analyzing_structure",):
        book.status = "identified" if book.phase1_done else "uploaded"
    elif book.status in ("summarizing", "quota_exceeded"):
        book.status = "structured" if book.phase2_done else "identified"
    elif book.status in ("generating_podcast",):
        book.status = "complete" if book.phase3_done else "structured"
    else:
        book.status = "error"

    book.error_msg = None
    await db.commit()
    return {"status": book.status}


# ═══════════════════════════════════════════════════════════════
# ── Cola de análisis (Queue Manager) ──────────────────════════
# ═══════════════════════════════════════════════════════════════

@router.get("/queue")
async def get_queue(current_user: User = Depends(get_current_user)):
    from app.workers.queue_manager import get_state
    return get_state(current_user.id)


@router.post("/queue/pause")
async def pause_queue(current_user: User = Depends(get_current_user)):
    from app.workers.queue_manager import pause
    pause(current_user.id)
    return {"ok": True, "paused": True}


@router.post("/queue/resume")
async def resume_queue(current_user: User = Depends(get_current_user)):
    from app.workers.queue_manager import resume
    resume(current_user.id)
    return {"ok": True, "paused": False}


@router.delete("/queue")
async def clear_queue(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.workers.queue_manager import get_state, cancel_all
    state = get_state(current_user.id)

    affected_ids = []
    if state.get("active"):
        affected_ids.append(state["active"])
    for entry in state.get("queue", []):
        affected_ids.append(entry["book_id"])

    for book_id in affected_ids:
        result = await db.execute(select(Book).where(Book.id == book_id))
        book = result.scalar_one_or_none()
        if book and book.status in ("queued", "identifying", "analyzing_structure",
                                    "summarizing", "generating_podcast"):
            if book.phase3_done:
                book.status = "complete"
            elif book.phase2_done:
                book.status = "structured"
            elif book.phase1_done:
                book.status = "identified"
            else:
                book.status = "uploaded"

    await db.commit()
    cancel_all(current_user.id)
    return {"ok": True, "cancelled": len(affected_ids)}


@router.delete("/queue/{book_id}")
async def cancel_book_from_queue(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.workers.queue_manager import cancel
    result_str = cancel(current_user.id, book_id)

    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if book and book.status in ("queued", "identifying", "analyzing_structure",
                                "summarizing", "generating_podcast"):
        if book.phase3_done:
            book.status = "complete"
        elif book.phase2_done:
            book.status = "structured"
        elif book.phase1_done:
            book.status = "identified"
        else:
            book.status = "uploaded"
        await db.commit()

    return {"ok": True, "result": result_str}
