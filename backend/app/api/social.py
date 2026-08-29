from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, and_, delete
from pydantic import BaseModel
from typing import Optional, List
from email.mime.text import MIMEText
import aiosmtplib

from app.core.security import get_current_user
from app.core.database import get_global_db, get_user_db
from app.core.config import settings
from app.models.user import User
from app.models.friendship import Friendship
from app.models.book import Book

router = APIRouter()


class InviteRequest(BaseModel):
    username_or_email: str


class ShareRequest(BaseModel):
    book_id: str
    friend_id: str


# ── Helper para enviar email ──────────────────────────────────────────
async def send_friend_request_email(recipient_email: str, recipient_username: str, sender_username: str, sender_email: str):
    if not settings.SMTP_HOST:
        print(f"[DEV] Email de solicitud de amistad para {recipient_email} de {sender_username}")
        return

    msg = MIMEText(f"""
    <h2>BookTracker - Solicitud de amistad</h2>
    <p>Hola <strong>{recipient_username}</strong>,</p>
    <p>El usuario <strong>{sender_username}</strong> ({sender_email}) quiere ser tu amigo en BookTracker.</p>
    <p>Inicia sesión en la aplicación para aceptar o rechazar la solicitud.</p>
    <br/>
    <p>Saludos,<br/>El equipo de BookTracker</p>
    """, "html")
    msg["Subject"] = "BookTracker - Solicitud de amistad"
    msg["From"] = settings.SMTP_FROM
    msg["To"] = recipient_email

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            start_tls=True,
        )
    except Exception as e:
        print(f"[ERROR] No se pudo enviar el correo de solicitud de amistad: {e}")


# ── Search Users ──────────────────────────────────────────────────────────────
@router.get("/search-users")
async def search_users(q: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    if not q or len(q) < 2:
        return []
    
    # Buscar usuarios por username o email, excluyendo al actual
    stmt = select(User).where(
        and_(
            User.id != current_user.id,
            or_(
                User.username.ilike(f"%{q}%"),
                User.email.ilike(f"%{q}%")
            )
        )
    ).limit(10)
    
    res = await db.execute(stmt)
    users = res.scalars().all()
    
    # También necesitamos ver si ya existe una relación de amistad o solicitud pendiente
    # para mostrárselo al usuario en los resultados de búsqueda.
    response = []
    for u in users:
        rel_stmt = select(Friendship).where(
            or_(
                and_(Friendship.user_id == current_user.id, Friendship.friend_id == u.id),
                and_(Friendship.user_id == u.id, Friendship.friend_id == current_user.id)
            )
        )
        rel_res = await db.execute(rel_stmt)
        rel = rel_res.scalar_one_or_none()
        
        status = "none"
        request_id = None
        if rel:
            status = rel.status
            request_id = rel.id
            if status == "pending" and rel.user_id == current_user.id:
                status = "sent_pending" # Enviada por mí
            elif status == "pending":
                status = "received_pending" # Recibida del otro
                
        response.append({
            "id": u.id,
            "username": u.username,
            "email": u.email,
            "avatar_color": u.avatar_color,
            "friendship_status": status,
            "friendship_request_id": request_id
        })
        
    return response


# ── Get Friends ───────────────────────────────────────────────────────────────
@router.get("/friends")
async def get_friends(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    stmt = select(Friendship).where(
        and_(
            Friendship.status == "accepted",
            or_(
                Friendship.user_id == current_user.id,
                Friendship.friend_id == current_user.id
            )
        )
    )
    res = await db.execute(stmt)
    friendships = res.scalars().all()
    
    friends = []
    for f in friendships:
        friend_id = f.friend_id if f.user_id == current_user.id else f.user_id
        u_stmt = select(User).where(User.id == friend_id)
        u_res = await db.execute(u_stmt)
        u = u_res.scalar_one_or_none()
        if u:
            friends.append({
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "avatar_color": u.avatar_color,
                "friendship_id": f.id,
                "since": f.created_at
            })
            
    return friends


# ── Get Requests ──────────────────────────────────────────────────────────────
@router.get("/requests")
async def get_requests(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    # Solicitudes recibidas
    rec_stmt = select(Friendship).where(
        and_(Friendship.friend_id == current_user.id, Friendship.status == "pending")
    )
    rec_res = await db.execute(rec_stmt)
    received_friendships = rec_res.scalars().all()
    
    received = []
    for f in received_friendships:
        u_stmt = select(User).where(User.id == f.user_id)
        u_res = await db.execute(u_stmt)
        u = u_res.scalar_one_or_none()
        if u:
            received.append({
                "id": f.id,
                "sender": {
                    "id": u.id,
                    "username": u.username,
                    "email": u.email,
                    "avatar_color": u.avatar_color
                },
                "created_at": f.created_at
            })
            
    # Solicitudes enviadas
    sent_stmt = select(Friendship).where(
        and_(Friendship.user_id == current_user.id, Friendship.status == "pending")
    )
    sent_res = await db.execute(sent_stmt)
    sent_friendships = sent_res.scalars().all()
    
    sent = []
    for f in sent_friendships:
        u_stmt = select(User).where(User.id == f.friend_id)
        u_res = await db.execute(u_stmt)
        u = u_res.scalar_one_or_none()
        if u:
            sent.append({
                "id": f.id,
                "recipient": {
                    "id": u.id,
                    "username": u.username,
                    "email": u.email,
                    "avatar_color": u.avatar_color
                },
                "created_at": f.created_at
            })
            
    return {
        "received": received,
        "sent": sent
    }


# ── Send Invitation ───────────────────────────────────────────────────────────
@router.post("/invite")
async def invite_friend(
    req: InviteRequest, 
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user), 
    db: AsyncSession = Depends(get_global_db)
):
    target_val = req.username_or_email.strip()
    if not target_val:
        raise HTTPException(400, "Debes proporcionar un usuario o email")
        
    if target_val.lower() == current_user.username.lower() or target_val.lower() == current_user.email.lower() or target_val == current_user.id:
        raise HTTPException(400, "No puedes enviarte una invitación a ti mismo")
        
    # Buscar al usuario
    stmt = select(User).where(
        or_(
            User.id == target_val,
            User.username == target_val,
            User.email == target_val
        )
    )
    res = await db.execute(stmt)
    target_user = res.scalar_one_or_none()
    
    if not target_user:
        raise HTTPException(404, "Usuario no encontrado")
        
    # Comprobar si ya existe una relación
    rel_stmt = select(Friendship).where(
        or_(
            and_(Friendship.user_id == current_user.id, Friendship.friend_id == target_user.id),
            and_(Friendship.user_id == target_user.id, Friendship.friend_id == current_user.id)
        )
    )
    rel_res = await db.execute(rel_stmt)
    rel = rel_res.scalar_one_or_none()
    
    if rel:
        if rel.status == "accepted":
            raise HTTPException(400, "Ya sois amigos")
        elif rel.user_id == current_user.id:
            raise HTTPException(400, "Ya has enviado una solicitud pendiente a este usuario")
        else:
            # Si el otro usuario ya me había enviado una solicitud, la aceptamos automáticamente
            rel.status = "accepted"
            await db.commit()
            return {"status": "success", "message": "Amistad aceptada automáticamente al coincidir las solicitudes"}
            
    # Crear nueva solicitud
    new_request = Friendship(
        user_id=current_user.id,
        friend_id=target_user.id,
        status="pending"
    )
    db.add(new_request)
    await db.commit()
    
    # Enviar correo de notificación en background
    background_tasks.add_task(
        send_friend_request_email,
        target_user.email,
        target_user.username,
        current_user.username,
        current_user.email
    )
    
    return {"status": "success", "message": "Solicitud de amistad enviada con éxito"}


# ── Accept Invitation ─────────────────────────────────────────────────────────
@router.post("/accept/{request_id}")
async def accept_friend(request_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    stmt = select(Friendship).where(
        and_(
            Friendship.id == request_id,
            Friendship.friend_id == current_user.id,
            Friendship.status == "pending"
        )
    )
    res = await db.execute(stmt)
    req = res.scalar_one_or_none()
    
    if not req:
        raise HTTPException(404, "Solicitud de amistad no encontrada")
        
    req.status = "accepted"
    await db.commit()
    return {"status": "success", "message": "Solicitud de amistad aceptada"}


# ── Reject/Cancel Invitation ──────────────────────────────────────────────────
@router.post("/reject/{request_id}")
async def reject_friend(request_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    stmt = select(Friendship).where(
        and_(
            Friendship.id == request_id,
            or_(
                Friendship.friend_id == current_user.id,
                Friendship.user_id == current_user.id
            )
        )
    )
    res = await db.execute(stmt)
    req = res.scalar_one_or_none()
    
    if not req:
        raise HTTPException(404, "Solicitud no encontrada")
        
    await db.delete(req)
    await db.commit()
    return {"status": "success", "message": "Solicitud eliminada/rechazada"}


# ── Remove Friend ─────────────────────────────────────────────────────────────
@router.post("/remove/{friend_id}")
async def remove_friend(friend_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    stmt = select(Friendship).where(
        and_(
            Friendship.status == "accepted",
            or_(
                and_(Friendship.user_id == current_user.id, Friendship.friend_id == friend_id),
                and_(Friendship.user_id == friend_id, Friendship.friend_id == current_user.id)
            )
        )
    )
    res = await db.execute(stmt)
    rel = rel_res = res.scalar_one_or_none()
    
    if not rel:
        raise HTTPException(404, "Amistad no encontrada")
        
    await db.delete(rel)
    await db.commit()
    
    # ⚠️ Limpiar libros compartidos mutuamente en las bases de datos de usuario correspondientes
    try:
        async for c_db in get_user_db(current_user.id):
            await c_db.execute(delete(Book).where(Book.shared_by_user_id == friend_id))
            await c_db.commit()
    except Exception as e:
        print(f"[ERROR] Al limpiar libros compartidos de {friend_id} en la BD de {current_user.username}: {e}")
        
    try:
        async for f_db in get_user_db(friend_id):
            await f_db.execute(delete(Book).where(Book.shared_by_user_id == current_user.id))
            await f_db.commit()
    except Exception as e:
        print(f"[ERROR] Al limpiar libros compartidos de {current_user.username} en la BD de {friend_id}: {e}")
        
    return {"status": "success", "message": "Amigo eliminado de tu lista y enlaces compartidos limpiados"}


# ── Book Share Status for Owner ───────────────────────────────────────────────
@router.get("/book-shares/{book_id}")
async def get_book_shares(book_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    # 1. Verificar que el libro existe en la BD del usuario actual
    async for c_db in get_user_db(current_user.id):
        res = await c_db.execute(select(Book).where(Book.id == book_id))
        book = res.scalar_one_or_none()
        if not book:
            raise HTTPException(404, "Libro no encontrado en tu biblioteca")
            
    # 2. Obtener lista de amigos aceptados
    f_stmt = select(Friendship).where(
        and_(
            Friendship.status == "accepted",
            or_(
                Friendship.user_id == current_user.id,
                Friendship.friend_id == current_user.id
            )
        )
    )
    f_res = await db.execute(f_stmt)
    friendships = f_res.scalars().all()
    
    response = []
    for f in friendships:
        friend_id = f.friend_id if f.user_id == current_user.id else f.user_id
        u_stmt = select(User).where(User.id == friend_id)
        u_res = await db.execute(u_stmt)
        u = u_res.scalar_one_or_none()
        
        if u:
            # Comprobar si ya está compartido en la base de datos de ese amigo
            is_shared = False
            try:
                async for f_db in get_user_db(friend_id):
                    check_stmt = select(Book).where(
                        and_(
                            Book.original_book_id == book_id,
                            Book.shared_by_user_id == current_user.id
                        )
                    )
                    check_res = await f_db.execute(check_stmt)
                    shared_book = check_res.scalar_one_or_none()
                    is_shared = shared_book is not None
            except Exception as e:
                print(f"[ERROR] Al comprobar compartición en base de datos de {u.username}: {e}")
                
            response.append({
                "id": u.id,
                "username": u.username,
                "email": u.email,
                "avatar_color": u.avatar_color,
                "is_shared": is_shared
            })
            
    return response


# ── Share Book ────────────────────────────────────────────────────────────────
@router.post("/share")
async def share_book(req: ShareRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_global_db)):
    # 1. Comprobar que son amigos
    f_stmt = select(Friendship).where(
        and_(
            Friendship.status == "accepted",
            or_(
                and_(Friendship.user_id == current_user.id, Friendship.friend_id == req.friend_id),
                and_(Friendship.user_id == req.friend_id, Friendship.friend_id == current_user.id)
            )
        )
    )
    f_res = await db.execute(f_stmt)
    if not f_res.scalar_one_or_none():
        raise HTTPException(400, "Solo puedes compartir libros con usuarios que sean tus amigos")
        
    # 2. Cargar metadatos del libro en la BD del usuario actual
    book = None
    async for c_db in get_user_db(current_user.id):
        b_res = await c_db.execute(select(Book).where(Book.id == req.book_id))
        book = b_res.scalar_one_or_none()
        
    if not book:
        raise HTTPException(404, "Libro no encontrado en tu biblioteca")
        
    # 3. Insertar o actualizar enlace en la BD del amigo
    async for f_db in get_user_db(req.friend_id):
        # Comprobar si ya existe
        check_stmt = select(Book).where(
            and_(
                Book.original_book_id == req.book_id,
                Book.shared_by_user_id == current_user.id
            )
        )
        check_res = await f_db.execute(check_stmt)
        shared_book = check_res.scalar_one_or_none()
        
        if not shared_book:
            import uuid
            new_shared = Book(
                id=str(uuid.uuid4()),
                title=book.title,
                author=book.author,
                isbn=book.isbn,
                cover_url=book.cover_url,
                cover_local=book.cover_local,
                synopsis=book.synopsis,
                genre=book.genre,
                year=book.year,
                status="complete",  # Al compartir, ya está analizado en el origen
                shared_by_user_id=current_user.id,
                original_book_id=book.id,
                owner_username=current_user.username
            )
            f_db.add(new_shared)
            await f_db.commit()
            
    return {"status": "success", "message": f"Libro compartido con éxito"}


# ── Unshare Book ──────────────────────────────────────────────────────────────
@router.post("/unshare")
async def unshare_book(req: ShareRequest, current_user: User = Depends(get_current_user)):
    # Eliminar el enlace de la BD del amigo
    async for f_db in get_user_db(req.friend_id):
        stmt = delete(Book).where(
            and_(
                Book.original_book_id == req.book_id,
                Book.shared_by_user_id == current_user.id
            )
        )
        await f_db.execute(stmt)
        await f_db.commit()
        
    return {"status": "success", "message": "Se ha dejado de compartir el libro"}
