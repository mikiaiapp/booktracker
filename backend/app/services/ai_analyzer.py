import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings

async def _call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    m = settings.AI_MODEL.lower()
    # Timeout total de 120s para la petición HTTP
    timeout = httpx.Timeout(120.0, connect=10.0)
    
    if "gemini" in m:
        api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY")
        url = f"https://generativelanguage.googleapis.com/v1/models/{settings.AI_MODEL}:generateContent?key={api_key}"
        payload = {"contents": [{"parts": [{"text": f"{system}\n\n{user}"}]}], "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3}}
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload)
            if r.status_code != 200: raise ValueError(f"Gemini Error: {r.text}")
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    else:
        # OpenAI
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        resp = await client.chat.completions.create(
            model=settings.AI_MODEL, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}]
        )
        return resp.choices[0].message.content

def _parse_json(text: str):
    if not text: return None
    # Limpieza rápida de markdown
    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()
    try:
        return json.loads(clean)
    except:
        # Intento de rescate si está truncado
        match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', clean)
        if match:
            try: return json.loads(match.group())
            except: return None
    return None

# --- FUNCIONES DE ANALISIS ---

async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: str) -> dict:
    system = "Eres un experto literario. Responde solo JSON: {\"summary\": \"...\", \"key_events\": []}"
    user = f"Libro: {book_title}. Capitulo: {chapter_title}. Texto: {text[:8000]}"
    try:
        raw = await _call_ai(system, user, 1500)
        return _parse_json(raw) or {"summary": raw[:500], "key_events": []}
    except: return {"summary": "Error en resumen", "key_events": []}

async def analyze_characters(all_summaries: str, book_title: str) -> list:
    print(f">>> Iniciando IA para personajes de '{book_title}'...")
    system = "Responde SOLO un array JSON [{\"name\":\"...\",\"role\":\"...\",\"description\":\"...\"}]"
    user = f"Libro: {book_title}. Resumenes: {all_summaries[:10000]}. Identifica los personajes principales y secundarios."
    try:
        raw = await asyncio.wait_for(_call_ai(system, user, 3000), timeout=150)
        data = _parse_json(raw)
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f">>> Error en analyze_characters: {e}")
        return []

async def generate_global_summary(all_summaries: str, book_title: str, author: str) -> str:
    print(f">>> Generando resumen global para '{book_title}'...")
    system = "Escribe un analisis literario profundo en espanol (minimo 800 palabras)."
    user = f"Libro: {book_title}. Resumenes: {all_summaries[:20000]}"
    return await _call_ai(system, user, 3500)

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    print(f">>> Generando mapa mental para '{book_title}'...")
    system = "Responde SOLO JSON con ramas: Trama, Personajes, Temas, Escenarios, Simbolos, Estilo."
    user = f"Mapa mental para: {book_title}. Info: {all_summaries[:12000]}"
    try:
        raw = await _call_ai(system, user, 2500)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except: return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title: str, author: str, summary: str, chars: list) -> str:
    print(f">>> Generando guion de podcast para '{book_title}'...")
    system = "Guion de podcast (ANA y CARLOS). Formato ANA: ... / CARLOS: ..."
    user = f"Libro: {book_title}. Resumen: {summary[:5000]}. Personajes: {str(chars)[:500]}"
    return await _call_ai(system, user, 3500)