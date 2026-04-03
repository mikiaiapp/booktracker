from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
import os
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

    # Comprobar si ya existe una ficha shell con el mismo nombre de fichero
    from sqlalchemy import func as sqlfunc
    base_title = file.filename.rsplit(".", 1)[0]
    existing_shell = await db.execute(
        select(Book).where(
            Book.status.in_(["shell", "shell_error"]),
            sqlfunc.lower(Book.title) == base_title.lower()
        )
    )
    shell_book = existing_shell.scalar_one_or_none()
    # También buscar por título exacto entre todos los libros (no solo shells)
    if not shell_book:
        existing_any = await db.execute(
            select(Book).where(
                sqlfunc.lower(Book.title) == base_title.lower()
            )
        )
        existing_any_book = existing_any.scalar_one_or_none()
        if existing_any_book and existing_any_book.status in ("shell", "shell_error"):
            shell_book = existing_any_book

    if shell_book:
        # Reusar la ficha shell existente
        shell_book.file_path = file_path
        shell_book.file_type = ext
        shell_book.file_size = len(content)
        shell_book.phase1_done = False
        shell_book.phase2_done = False
        shell_book.phase3_done = False
        await db.commit()
        book = shell_book
        book_id = shell_book.id
    else:
        book = Book(
            id=book_id,
            title=base_title,
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
            "cover_local": b.cover_local, "cover_url": b.cover_url,
            "isbn": b.isbn, "status": b.status,
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

    # Otros libros del mismo autor (ordenados por año desc)
    other_books = []
    if book.author:
        from sqlalchemy import case
        others_result = await db.execute(
            select(Book)
            .where(Book.author == book.author, Book.id != book_id)
            .order_by(case((Book.year == None, 0), else_=1).desc(), Book.year.desc(), Book.title)
        )
        other_books = [
            {
                "id": b.id, "title": b.title, "isbn": b.isbn,
                "cover_local": b.cover_local, "year": b.year,
                "status": b.status, "phase3_done": b.phase3_done,
                "synopsis": b.synopsis,
            }
            for b in others_result.scalars().all()
        ]

    return {
        "book": book.__dict__,
        "parts": [p.__dict__ for p in parts_result.scalars().all()],
        "chapters": [c.__dict__ for c in chapters_result.scalars().all()],
        "characters": [c.__dict__ for c in chars_result.scalars().all()],
        "other_books": other_books,
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


# ── Actualizar portada ────────────────────────────────────────
@router.patch("/{book_id}/cover")
async def update_cover(
    book_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Guarda una cover_url elegida por el usuario y descarga la imagen localmente."""
    body = await request.json()
    cover_url = body.get("cover_url", "").strip()
    if not cover_url:
        raise HTTPException(400, "cover_url requerida")

    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    book.cover_url = cover_url

    # Intentar descargar localmente
    try:
        from app.core.config import settings
        from app.services.book_identifier import download_cover
        covers_dir = os.path.join(settings.COVERS_DIR, current_user.id)
        local = await download_cover(cover_url, covers_dir, book_id)
        if local:
            book.cover_local = local
    except Exception as e:
        print(f"Cover download error: {e}")

    await db.commit()
    return {"ok": True, "cover_url": cover_url, "cover_local": book.cover_local}


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


# ── Subir portada desde archivo ──────────────────────────────
@router.post("/{book_id}/cover/upload")
async def upload_cover(
    book_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sube una imagen desde el equipo del usuario como portada del libro."""
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    # Validar tipo de archivo
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "El archivo debe ser una imagen")

    try:
        from app.core.config import settings
        covers_dir = os.path.join(settings.COVERS_DIR, current_user.id)
        os.makedirs(covers_dir, exist_ok=True)
        filename = f"{book_id}_cover.jpg"
        local_path = os.path.join(covers_dir, filename)

        contents = await file.read()
        if len(contents) < 1000:
            raise HTTPException(400, "La imagen es demasiado pequeña")

        # Convertir a JPEG si es necesario usando pillow (si disponible), si no guardar tal cual
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(contents))
            img = img.convert("RGB")
            with open(local_path, "wb") as f:
                img.save(f, "JPEG", quality=90)
        except ImportError:
            # Sin pillow: guardar directamente
            with open(local_path, "wb") as f:
                f.write(contents)

        book.cover_local = local_path
        book.cover_url = None  # ya tenemos local, limpiar URL externa
        await db.commit()
        return {"ok": True, "cover_local": local_path}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Error al guardar la imagen: {e}")



class CreateShellRequest(BaseModel):
    title: str
    author: Optional[str] = None
    isbn: Optional[str] = None
    year: Optional[int] = None
    cover_url: Optional[str] = None
    synopsis: Optional[str] = None


@router.post("/shell", status_code=201)
async def create_shell_book(
    req: CreateShellRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Crea una ficha de libro sin archivo — busca metadatos automáticamente."""
    import uuid

    # Comprobar duplicados por ISBN (si viene) o por título+autor
    from sqlalchemy import func as sqlfunc, or_
    conditions = []
    if req.isbn:
        conditions.append(Book.isbn == req.isbn)
    conditions.append(
        (sqlfunc.lower(Book.title) == req.title.lower()) &
        (sqlfunc.lower(Book.author) == req.author.lower() if req.author else True)
    )
    existing = await db.execute(select(Book).where(or_(*conditions)))
    if existing.scalar_one_or_none():
        raise HTTPException(400, "Este libro ya está en tu biblioteca")

    book_id = str(uuid.uuid4())
    book = Book(
        id=book_id,
        title=req.title,
        author=req.author,
        isbn=req.isbn,
        year=req.year,
        cover_url=req.cover_url,
        synopsis=req.synopsis,
        file_type=None,
        file_path=None,
        status="shell",          # sin archivo, solo ficha
        phase1_done=False,
    )
    db.add(book)
    await db.commit()

    # Lanzar búsqueda de metadatos en background
    from app.workers.tasks import fetch_shell_metadata
    fetch_shell_metadata.delay(current_user.id, book_id)

    return {"id": book_id, "status": "shell"}


# ── Subir PDF a ficha shell existente ─────────────────────────
@router.post("/{book_id}/upload-file", status_code=200)
async def upload_file_to_shell(
    book_id: str,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Sube un PDF/EPUB a una ficha shell para convertirla en libro analizable."""
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")
    if book.status not in ("shell", "shell_error"):
        raise HTTPException(400, "Este libro ya tiene un archivo")

    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("pdf", "epub"):
        raise HTTPException(400, "Solo se admiten PDF y EPUB")

    filename = f"{book_id}.{ext}"
    user_dir = os.path.join(settings.UPLOADS_DIR, current_user.id)
    os.makedirs(user_dir, exist_ok=True)
    file_path = os.path.join(user_dir, filename)

    async with aiofiles.open(file_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    book.file_path = file_path
    book.file_type = ext
    book.file_size = len(content)
    book.status = "uploaded"
    book.phase1_done = False
    book.phase2_done = False
    book.phase3_done = False
    await db.commit()

    # Lanzar fase 1 para identificar/confirmar metadatos
    from app.workers.tasks import process_book_phase1
    task = process_book_phase1.delay(current_user.id, book_id)
    book.task_id = task.id
    book.status = "identifying"
    await db.commit()

    return {"id": book_id, "status": "identifying", "task_id": task.id}
