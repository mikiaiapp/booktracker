from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request
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


def _normalize_author_words(name: str) -> set:
    import re
    stop = {'i', 'y', 'de', 'del', 'la', 'el', 'von', 'van', 'di', 'da', 'du', 'le'}
    clean = re.sub(r'[^\w\s]', ' ', name.strip(), flags=re.UNICODE)
    return {w.lower() for w in clean.split() if w.lower() not in stop and len(w) > 1}


def _is_name_inversion(name_a: str, name_b: str) -> bool:
    import re
    clean = lambda s: set(re.sub(r'[^\w\s]', ' ', s.strip(), flags=re.UNICODE).lower().split())
    words_a = clean(name_a)
    words_b = clean(name_b)
    return len(words_a) >= 2 and words_a == words_b


async def _find_existing_book(db, title: str, author: str, isbn: str, exclude_id: str = None):
    """
    Busca si ya existe un libro en la BD con el mismo ISBN o título+autor.
    Retorna el libro encontrado o None.
    """
    from sqlalchemy import select

    # 1. Match por ISBN (siempre es la prueba más robusta)
    if isbn:
        isbn_b = _isbn_base(isbn)
        result = await db.execute(select(Book).where(Book.isbn == isbn))
        b = result.scalar_one_or_none()
        if b and (not exclude_id or b.id != exclude_id):
            return b
        
        # También buscar por ISBN base
        if isbn_b:
            result = await db.execute(select(Book).where(Book.isbn.like(f"{isbn_b}%")))
            all_isbn_matches = result.scalars().all()
            for b in all_isbn_matches:
                if not exclude_id or b.id != exclude_id:
                    return b

    # 2. Match por Título + Autor
    if title and author:
        norm_title = _normalize_title(title)
        author_words = _normalize_author_words(author)

        result = await db.execute(select(Book).where(Book.id != exclude_id if exclude_id else True))
        all_books = result.scalars().all()

        for b in all_books:
            if b.title and _normalize_title(b.title) == norm_title:
                # Comprobar si el autor coincide
                if b.author:
                    if b.author == author: return b
                    if _is_name_inversion(b.author, author): return b
                    bw = _normalize_author_words(b.author)
                    if bw and author_words and len(bw & author_words) >= 2:
                        return b
    
    return None


# ── Upload book ───────────────────────────────────────────────────────────────
@router.post("/upload", status_code=201)
async def upload_book(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # Validate file type
    print(f"[API] Iniciando subida de: {file.filename}")
    if not file.filename:
        raise HTTPException(400, "Nombre de archivo no válido")
    
    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("pdf", "epub"):
        raise HTTPException(400, "Solo se admiten archivos PDF y EPUB")

    def sanitize_title(title: str) -> str:
        import re
        # Quitar caracteres que no sean alfanuméricos, espacios, puntos o guiones
        s = re.sub(r'[^\w\s\.-]', '', title).strip()
        return s[:150] or "Libro sin titulo"

    try:
        content = await file.read()
        print(f"[API] Archivo leido: {len(content)} bytes")
    except Exception as e:
        print(f"[API] Error al leer archivo: {e}")
        raise HTTPException(500, f"Error al leer el archivo: {e}")

    shell_book = None
    book_id = str(uuid.uuid4())
    filename = f"{book_id}.{ext}"
    user_dir = os.path.join(settings.UPLOADS_DIR, current_user.id)
    
    try:
        os.makedirs(user_dir, exist_ok=True)
        file_path = os.path.join(user_dir, filename)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)
        print(f"[API] Archivo guardado en: {file_path}")
    except Exception as e:
        print(f"[API] Error al guardar archivo: {e}")
        raise HTTPException(500, f"Error al guardar disco: {e}")

    try:
        base_title = sanitize_title(file.filename.rsplit(".", 1)[0])
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
        print(f"[API] Libro registrado en DB: {book.id}")
    except Exception as e:
        print(f"[API] Error DB: {e}")
        raise HTTPException(500, f"Error base de datos: {e}")

    # Encolar en la cola serializada
    try:
        book.status = "queued"
        await db.commit()
        
        from app.workers.queue_manager import enqueue as q_enqueue
        q_enqueue(current_user.id, book.id, book.title, ["1", "2", "3", "4", "5", "6"])
        print(f"[API] Libro encolado con éxito (F1-F6)")
    except Exception as e:
        print(f"[API] Error al encolar: {e}")

    return {"id": book.id, "status": "queued", "task_id": None}



# ── List books ────────────────────────────────────────────────────────────────
@router.get("/")
async def list_books(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from sqlalchemy import func
    result = await db.execute(select(Book).order_by(Book.created_at.desc()))
    books = result.scalars().all()
    
    # AUTO-REPARACIÓN: Si hay libros marcados como 'shell' pero tienen archivo, 
    # es que son libros reales "escondidos". Los rescatamos.
    repaired = False
    for b in books:
        if b.status == "shell" and b.file_path:
            b.status = "identified"
            repaired = True
    if repaired:
        await db.commit()

    # Pre-cargar conteos de capítulos y personajes para "curar" estados atascados
    # (Agrupados por book_id para eficiencia)
    ch_counts_res = await db.execute(
        select(Chapter.book_id, func.count(Chapter.id))
        .where(Chapter.book_id.in_([b.id for b in books]))
        .group_by(Chapter.book_id)
    )
    ch_counts = {r[0]: r[1] for r in ch_counts_res.all()}

    response = []
    for b in books:
        # Detectar si el libro está realmente en proceso (basado en el nuevo pipeline)
        is_analyzing = b.status in ("queued", "identifying", "analyzing", "structuring", "summarizing")
        
        # Si tiene fases hechas pero no todas, y no está marcado como complete, es 'incomplete' (A Medias)
        status = b.status
        is_complete = (
            b.phase1_done and b.phase2_done and b.phase3_done and 
            b.phase4_done and b.phase5_done and b.phase6_done
        )
        
        if is_complete:
            status = "complete"
        elif is_analyzing:
            status = "analyzing"
        elif any([b.phase1_done, b.phase2_done, b.phase3_done, b.phase4_done, b.phase5_done]):
            status = "incomplete"

        response.append({
            "id": b.id, "title": b.title, "author": b.author,
            "cover_local": b.cover_local, "cover_url": b.cover_url,
            "isbn": b.isbn, "status": status,
            "read_status": b.read_status, "rating": b.rating,
            "phase1_done": b.phase1_done, "phase2_done": b.phase2_done,
            "phase3_done": b.phase3_done, "phase4_done": b.phase4_done,
            "phase5_done": b.phase5_done, "phase6_done": b.phase6_done,
            "created_at": b.created_at,
            "has_chapters": ch_counts.get(b.id, 0) > 0,
            "has_characters": char_counts.get(b.id, 0) > 0
        })
    
    return response


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

    def _safe_json(val, default=[]):
        if not val: return default
        if isinstance(val, (list, dict)): return val
        try:
            import json
            return json.loads(val)
        except: return default

    # Limpiar y normalizar capítulos para evitar fallos en el frontend
    chapters_data = []
    for c in chapters_result.scalars().all():
        cd = {
            "id": c.id,
            "title": c.title or "Sin título",
            "order": c.order,
            "summary": c.summary or "",
            "key_events": _safe_json(c.key_events, []),
            "summary_status": "done" if c.summary and len(c.summary) > 10 else "pending"
        }
        chapters_data.append(cd)

    # Limpiar y normalizar personajes
    chars_data = []
    for c in chars_result.scalars().all():
        chars_data.append({
            "id": c.id,
            "name": c.name or "Desconocido",
            "role": c.role or "",
            "description": c.description or "",
            "personality": c.personality or "",
            "arc": c.arc or "",
            "relationships": _safe_json(c.relationships, {}),
            "key_moments": _safe_json(c.key_moments, []),
            "quotes": _safe_json(c.quotes, [])
        })

    return {
        "book": {
            "id": book.id,
            "title": book.title,
            "author": book.author,
            "isbn": book.isbn,
            "synopsis": book.synopsis or "",
            "author_bio": book.author_bio or "",
            "genre": book.genre or "",
            "year": book.year,
            "status": book.status,
            "phase1_done": book.phase1_done,
            "phase2_done": book.phase2_done,
            "phase3_done": book.phase3_done,
            "global_summary": book.global_summary or "",
            "mindmap_data": _safe_json(book.mindmap_data, {"center": book.title, "branches": []})
        },
        "parts": [p.__dict__ for p in parts_result.scalars().all()],
        "chapters": chapters_data,
        "characters": chars_data,
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
        old_cover = book.cover_local
        local = await download_cover(cover_url, covers_dir, book_id)
        if local:
            book.cover_local = local
            if old_cover and old_cover != local and os.path.exists(old_cover):
                try: os.remove(old_cover)
                except: pass
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

    author = book.author

    # Borrar archivo físico
    if book.file_path and os.path.exists(book.file_path):
        os.remove(book.file_path)
    # Borrar portada local si existe
    if book.cover_local and os.path.exists(book.cover_local):
        try:
            os.remove(book.cover_local)
        except Exception:
            pass

    await db.delete(book)
    await db.commit()

    # Si el autor no tiene más libros analizados, borrar todos sus libros shell
    if author:
        analyzed = await db.execute(
            select(Book).where(
                Book.author == author,
                Book.phase3_done == True
            )
        )
        if not analyzed.scalar_one_or_none():
            shells = await db.execute(
                select(Book).where(
                    Book.author == author,
                    Book.status.in_(["shell", "shell_error", "identified", "uploaded"])
                )
            )
            for shell in shells.scalars().all():
                if shell.cover_local and os.path.exists(shell.cover_local):
                    try:
                        os.remove(shell.cover_local)
                    except Exception:
                        pass
                await db.delete(shell)
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
    """Sube una imagen desde el equipo del usuario como portada del libro.
    Acepta cualquier formato gráfico soportado por Pillow (JPEG, PNG, WebP,
    AVIF, HEIC, BMP, TIFF, GIF, ICO, TGA, PPM y más).
    """
    result = await db.execute(select(Book).where(Book.id == book_id))
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(404, "Book not found")

    contents = await file.read()
    if len(contents) < 500:
        raise HTTPException(400, "El archivo es demasiado pequeño")

    try:
        from app.services.book_identifier import _bytes_to_jpeg
        from app.core.config import settings
        import time
        covers_dir = os.path.join(settings.COVERS_DIR, current_user.id)
        os.makedirs(covers_dir, exist_ok=True)
        filename = f"{book_id}_cover_{int(time.time())}.jpg"
        local_path = os.path.join(covers_dir, filename)

        try:
            jpeg_data = _bytes_to_jpeg(contents)
        except Exception as e:
            raise HTTPException(400, f"Formato de imagen no soportado: {e}")

        if len(jpeg_data) < 500:
            raise HTTPException(400, "La imagen no pudo procesarse correctamente")

        with open(local_path, "wb") as f:
            f.write(jpeg_data)

        old_cover = book.cover_local
        book.cover_local = local_path
        book.cover_url = None  # ya tenemos local, limpiar URL externa
        await db.commit()
        
        if old_cover and old_cover != local_path and os.path.exists(old_cover):
            try: os.remove(old_cover)
            except: pass
            
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

    # Comprobar duplicados por ISBN (si viene) o por título+autor
    existing = await _find_existing_book(db, req.title, req.author, req.isbn)
    if existing:
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

    # Encolar en la cola serializada
    book.status = "queued"
    await db.commit()

    from app.workers.queue_manager import enqueue as q_enqueue
    q_enqueue(current_user.id, book_id, book.title, ["1", "2", "3", "4", "5", "6"])

    return {"id": book_id, "status": "queued", "task_id": None}
