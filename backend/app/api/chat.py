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
        res_ch = await db.execute(select(Chapter).where(Chapter.book_id == book_id).order_by(Chapter.order))
        chaps = res_ch.scalars().all()
        summaries = "\n".join([f"Capítulo {c.title}: {c.summary}" for c in chaps if c.summary])
        
        res_char = await db.execute(select(Character).where(Character.book_id == book_id))
        chars = res_char.scalars().all()
        chars_str = "\n".join([f"Personaje {c.name}: {c.description}" for c in chars if c.description])
        
        context = f"SINOPSIS: {book.synopsis}\n--- RESUMEN ---\n{summaries}\n--- PERSONAJES ---\n{chars_str}\n--- ENSAYO GLOBAL ---\n{book.global_summary}"

        # 4. Obtener historial reciente
        res_h = await db.execute(select(ChatMessage).where(ChatMessage.book_id == book_id).order_by(ChatMessage.created_at.desc()).limit(6))
        history = [{"role": m.role, "content": m.content} for m in res_h.scalars().all()]
        history.reverse()

        # 5. Llamar a la IA
        from app.services.ai_analyzer import talk_to_book
        api_keys = {
            "gemini": user.gemini_api_key,
            "openai": user.openai_api_key,
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
