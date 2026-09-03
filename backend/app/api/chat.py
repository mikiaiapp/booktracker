from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.core.database import get_user_db
from app.models.book import Book, Chapter, Character, ChatMessage
from app.models.user import User
# from app.services.ai_analyzer import talk_to_book (movido a local para evitar circularidad)
from app.core.security import get_current_user
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

class ChatRequest(BaseModel):
    message: str
    mode: str = "default"
    model: Optional[str] = "auto"

class MessageSchema(BaseModel):
    role: str
    content: str
    model: Optional[str] = None
    created_at: Optional[str] = None

@router.get("/{book_id}/history", response_model=List[MessageSchema])
async def get_chat_history(book_id: str, user: User = Depends(get_current_user)):
    async for db in get_user_db(user.id):
        res = await db.execute(select(ChatMessage).where(ChatMessage.book_id == book_id).order_by(ChatMessage.created_at))
        msgs = res.scalars().all()
        return [{"role": m.role, "content": m.content, "model": m.model, "created_at": m.created_at.isoformat()} for m in msgs]

@router.post("/{book_id}/send")
async def send_chat_message(book_id: str, req: ChatRequest, user: User = Depends(get_current_user)):
    async for db in get_user_db(user.id):
        # 1. Obtener libro y validarlo
        book = (await db.execute(select(Book).where(Book.id == book_id))).scalar_one_or_none()
        if not book: raise HTTPException(status_code=404, detail="Libro no encontrado")

        # 2. Guardar mensaje usuario
        user_msg = ChatMessage(book_id=book_id, role="user", content=req.message, mode=req.mode)
        db.add(user_msg)
        await db.commit()

        # 3. Preparar contexto (Resúmenes + Personajes)
        source_book = book
        source_db = db
        source_book_id = book_id

        is_shared = getattr(book, 'shared_by_user_id', None) is not None
        shared_by_user_id = getattr(book, 'shared_by_user_id', None)
        original_book_id = getattr(book, 'original_book_id', None)

        if is_shared and shared_by_user_id and original_book_id:
            source_book_id = original_book_id
            async for owner_db in get_user_db(shared_by_user_id):
                orig_res = await owner_db.execute(select(Book).where(Book.id == original_book_id))
                loaded_orig = orig_res.scalar_one_or_none()
                if loaded_orig:
                    source_book = loaded_orig
                    source_db = owner_db
                break

        res_ch = await source_db.execute(select(Chapter).where(Chapter.book_id == source_book_id).order_by(Chapter.order))
        chaps = res_ch.scalars().all()
        summaries = "\n".join([f"Capítulo {c.title}: {c.summary}" for c in chaps if c.summary])
        
        res_char = await source_db.execute(select(Character).where(Character.book_id == source_book_id))
        chars = res_char.scalars().all()
        chars_str = "\n".join([f"Personaje {c.name}: {c.description}" for c in chars if c.description])
        
        context = f"SINOPSIS: {source_book.synopsis or ''}\n--- RESUMEN ---\n{summaries}\n--- PERSONAJES ---\n{chars_str}\n--- ENSAYO GLOBAL ---\n{source_book.global_summary or ''}"

        # 4. Obtener historial reciente
        res_h = await db.execute(select(ChatMessage).where(ChatMessage.book_id == book_id).order_by(ChatMessage.created_at.desc()).limit(6))
        history = [{"role": m.role, "content": m.content} for m in res_h.scalars().all()]
        history.reverse()

        # 5. Llamar a la IA
        from app.services.ai_analyzer import talk_to_book
        api_keys = {
            "gemini": user.gemini_api_key,
            "openai": user.openai_api_key,
            "groq": getattr(user, 'groq_api_key', None),
            "preferred_model": req.model if req.model != "auto" else user.preferred_model
        }
        ai_resp, used_m = await talk_to_book(book.title, book.author, context, req.message, req.mode, history, api_keys=api_keys)

        # 6. Guardar respuesta IA
        ai_msg = ChatMessage(book_id=book_id, role="assistant", content=ai_resp, mode=req.mode, model=used_m)
        db.add(ai_msg)
        await db.commit()

        return {"response": ai_resp, "model": used_m}

@router.delete("/{book_id}/clear")
async def clear_chat_history(book_id: str, user: User = Depends(get_current_user)):
    async for db in get_user_db(user.id):
        await db.execute(delete(ChatMessage).where(ChatMessage.book_id == book_id))
        await db.commit()
        return {"status": "ok"}
