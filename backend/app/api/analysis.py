from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.security import get_current_user
from app.core.database import get_user_db
from app.models.user import User
from app.models.book import Book, AnalysisJob

router = APIRouter()


async def get_db(current_user: User = Depends(get_current_user)):
    async for session in get_user_db(current_user.id):
        yield session


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

    return {
        "status": book.status,
        "phase1_done": book.phase1_done,
        "phase2_done": book.phase2_done,
        "phase3_done": book.phase3_done,
        "error_msg": book.error_msg,
        "jobs": [{"phase": j.phase, "status": j.status, "progress": j.progress, "detail": j.detail} for j in jobs],
    }


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
