from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import aiofiles

from app.core.config import settings
from app.core.security import get_current_user
from app.core.database import get_user_db
from app.models.user import User
from app.models.book import Book, Chapter, Character, BookPart

router = APIRouter()


async def get_db(current_user: User = Depends(get_current_user)):
    async for session in get_user_db(current_user.id):
        yield session


# ── Upload book ───────────────────────────────────────────────────────────────
@router.post("/upload", status_code=201)
async def upload_book(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate file type
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("pdf", "epub"):
        raise HTTPException(400, "Only PDF and EPUB files are supported")

    book_id = str(uuid.uuid4())
    filename = f"{book_id}.{ext}"
    user_dir = os.path.join(settings.UPLOADS_DIR, current_user.id)
    os.makedirs(user_dir, exist_ok=True)
    file_path = os.path.join(user_dir, filename)

    async with aiofiles.open(file_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    book = Book(
        id=book_id,
        title=file.filename.rsplit(".", 1)[0],
        file_path=file_path,
        file_type=ext,
        file_size=len(content),
        status="uploaded",
    )
    db.add(book)
    await db.commit()
    await db.refresh(book)

    # Queue phase 1
    from app.workers.tasks import process_book_phase1
    task = process_book_phase1.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status = "identifying"
    await db.commit()

    return {"id": book.id, "status": book.status, "task_id": book.task_id}


# ── List books ────────────────────────────────────────────────────────────────
@router.get("/")
async def list_books(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).order_by(Book.created_at.desc()))
    books = result.scalars().all()
    return [
        {
            "id": b.id, "title": b.title, "author": b.author,
            "cover_local": b.cover_local, "status": b.status,
            "read_status": b.read_status, "rating": b.rating,
            "phase1_done": b.phase1_done, "phase2_done": b.phase2_done,
            "phase3_done": b.phase3_done, "created_at": b.created_at,
        }
        for b in books
    ]


# ── Book detail ───────────────────────────────────────────────────────────────
@router.get("/{book_id}")
async def get_book(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    parts_result = await db.execute(
        select(BookPart).where(BookPart.book_id == book_id).order_by(BookPart.order)
    )
    chapters_result = await db.execute(
        select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order)
    )
    chars_result = await db.execute(
        select(Character).where(Character.book_id == book_id)
    )

    return {
        "book": book.__dict__,
        "parts": [p.__dict__ for p in parts_result.scalars().all()],
        "chapters": [c.__dict__ for c in chapters_result.scalars().all()],
        "characters": [c.__dict__ for c in chars_result.scalars().all()],
    }


# ── Update reading status ─────────────────────────────────────────────────────
class UpdateBookRequest(BaseModel):
    read_status: Optional[str] = None
    rating: Optional[float] = None
    notes: Optional[str] = None


@router.patch("/{book_id}")
async def update_book(
    book_id: str,
    req: UpdateBookRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    if req.read_status is not None:
        book.read_status = req.read_status
    if req.rating is not None:
        book.rating = req.rating
    if req.notes is not None:
        book.notes = req.notes

    await db.commit()
    return {"ok": True}


# ── Delete book ───────────────────────────────────────────────────────────────
@router.delete("/{book_id}")
async def delete_book(
    book_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    # Remove file
    if book.file_path and os.path.exists(book.file_path):
        os.remove(book.file_path)

    await db.delete(book)
    await db.commit()
    return {"ok": True}
