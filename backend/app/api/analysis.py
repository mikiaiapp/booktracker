from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.core.security import get_current_user
from app.core.database import get_user_db
from app.models.user import User
from app.models.book import Book, AnalysisJob, Chapter

router = APIRouter()


async def get_db(current_user: User = Depends(get_current_user)):
    async for session in get_user_db(current_user.id):
        yield session


# ── Fase 1 (relanzar identificación) ─────────────────────────
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
    task = process_book_phase1.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status = "identifying"
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
    task = process_book_phase2.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status = "analyzing_structure"
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# ── Fase 3 completa ───────────────────────────────────────────
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

    from app.workers.tasks import process_book_phase3
    task = process_book_phase3.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status = "summarizing"
    book.error_msg = None
    await db.commit()
    return {"task_id": task.id}


# ── Resumen de un capítulo individual ─────────────────────────
@router.post("/{book_id}/chapter/{chapter_id}/summarize")
async def summarize_single_chapter(
    book_id: str,
    chapter_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resume un capítulo concreto sin necesidad de lanzar toda la Fase 3."""
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


# ── Podcast ───────────────────────────────────────────────────
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
        raise HTTPException(400, "Phase 3 not complete")

    from app.workers.tasks import generate_podcast
    task = generate_podcast.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status = "generating_podcast"
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

    # Progreso capítulos
    ch_result = await db.execute(select(Chapter).where(Chapter.book_id == book_id))
    chapters = ch_result.scalars().all()
    total_ch = len(chapters)
    done_ch = sum(1 for c in chapters if c.summary_status == "done")

    # chapters_analyzed = fase 3 completó personajes+resumen+mapa (phase3_done)
    # chapters_summarized = todos los capítulos tienen resumen (puede ser true antes de phase3_done)
    chapters_summarized = total_ch > 0 and done_ch == total_ch

    return {
        "status": book.status,
        "phase1_done": book.phase1_done,
        "phase2_done": book.phase2_done,
        "phase3_done": book.phase3_done,
        "chapters_summarized": chapters_summarized,
        "has_global_summary": bool(book.global_summary),
        "podcast_done": book.status == "complete" and bool(book.podcast_script),
        "error_msg": book.error_msg,
        "chapters_total": total_ch,
        "chapters_done": done_ch,
        "podcast_audio_path": book.podcast_audio_path,
        "podcast_script": bool(book.podcast_script),
        "jobs": [{"phase": j.phase, "status": j.status, "progress": j.progress, "detail": j.detail} for j in jobs],
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


# ── Autores ───────────────────────────────────────────────────
@router.get("/authors/list")
async def list_authors(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve todos los autores únicos con sus libros."""
    result = await db.execute(
        select(Book.author, Book.author_bio, Book.author_bibliography,
               Book.id, Book.title, Book.cover_local, Book.year, Book.status,
               Book.phase3_done, Book.isbn)
        .where(Book.author.isnot(None))
        .order_by(Book.author)
    )
    rows = result.all()

    # Agrupar por autor
    authors: dict = {}
    for row in rows:
        author = row.author
        if not author:
            continue
        if author not in authors:
            # Normalizar bibliografía: acepta tanto strings como {title, isbn}
            raw_biblio = row.author_bibliography or []
            biblio = []
            for item in raw_biblio:
                if isinstance(item, str):
                    biblio.append({"title": item, "isbn": None})
                elif isinstance(item, dict):
                    biblio.append({"title": item.get("title", ""), "isbn": item.get("isbn")})
            authors[author] = {
                "name": author,
                "bio": row.author_bio,
                "bibliography": biblio,
                "books": [],
            }
        authors[author]["books"].append({
            "id": row.id,
            "title": row.title,
            "cover_local": row.cover_local,
            "year": row.year,
            "status": row.status,
            "phase3_done": row.phase3_done,
            "isbn": row.isbn,
        })

    # Sort books within each author by year desc
    for author_data in authors.values():
        author_data["books"].sort(
            key=lambda b: (b.get("year") or 0),
            reverse=True
        )

    return list(authors.values())


# ── Reidentificar autor ────────────────────────────────────────
@router.post("/authors/reidentify")
async def reidentify_author(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from pydantic import BaseModel as BM
    body = await request.json()
    author_name = body.get("author")
    if not author_name:
        raise HTTPException(400, "author required")

    # Buscar todos los libros de este autor para actualizar bio y bibliografía
    result = await db.execute(
        select(Book).where(Book.author == author_name)
    )
    books = result.scalars().all()
    if not books:
        raise HTTPException(404, "Author not found")

    # Lanzar tarea de reidentificación del autor
    from app.workers.tasks import reidentify_author_task
    task = reidentify_author_task.delay(current_user.id, author_name)
    return {"task_id": task.id, "status": "processing"}


# ── Reidentificar libro individual ─────────────────────────────
@router.post("/{book_id}/reidentify-book")
async def reidentify_book(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Relanza fetch_shell_metadata para actualizar portada, sinopsis e ISBN de un libro."""
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    # Resetear status para que fetch_shell_metadata lo actualice
    book.status = "shell"
    book.phase1_done = False
    await db.commit()

    from app.workers.tasks import fetch_shell_metadata
    fetch_shell_metadata.delay(current_user.id, book_id)

    return {"status": "updating"}


# ── Reanalizar personajes ──────────────────────────────────────
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
        raise HTTPException(400, "La fase 3 debe estar completa")

    from app.workers.tasks import reanalyze_characters_task
    task = reanalyze_characters_task.delay(current_user.id, book_id)
    return {"task_id": task.id, "status": "processing"}


# ── Cancelar proceso en curso ──────────────────────────────────
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

    # Determinar a qué estado volver según qué fase estaba corriendo
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
