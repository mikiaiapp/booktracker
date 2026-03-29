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

    return {
        "status": book.status,
        "phase1_done": book.phase1_done,
        "phase2_done": book.phase2_done,
        "phase3_done": book.phase3_done,
        "error_msg": book.error_msg,
        "chapters_total": total_ch,
        "chapters_done": done_ch,
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
