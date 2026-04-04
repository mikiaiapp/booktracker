import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings

async def _call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    m = settings.AI_MODEL.lower()
    timeout = httpx.Timeout(180.0, connect=10.0) # Aumentado a 180s para respuestas largas
    
    if "gemini" in m:
        api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY")
        url = f"https://generativelanguage.googleapis.com/v1/models/{settings.AI_MODEL}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": f"{system}\n\n{user}"}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.4}
        }
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload)
            if r.status_code != 200: raise ValueError(f"Gemini Error: {r.text}")
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    else:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        resp = await client.chat.completions.create(
            model=settings.AI_MODEL, max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}]
        )
        return resp.choices[0].message.content

def _parse_json(text: str):
    if not text: return None
    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()
    try:
        return json.loads(clean)
    except:
        match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', clean)
        if match:
            try: return json.loads(match.group())
            except: return None
    return None

# --- FUNCIONES DE ANALISIS ---

async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: str) -> dict:
    system = "Eres un experto literario de España. Responde siempre en español de España y solo en JSON."
    user = f"Libro: {book_title}. Capitulo: {chapter_title}. Resume el texto destacando spoilers y eventos clave: {text[:8000]}"
    try:
        raw = await _call_ai(system, user, 1500)
        return _parse_json(raw) or {"summary": raw, "key_events": []}
    except: return {"summary": "Error", "key_events": []}

async def analyze_characters(all_summaries: str, book_title: str) -> list:
    """Análisis detallado en dos pasadas: Principales (Full) y Secundarios (Breve)"""
    print(f">>> [IA] Analizando personajes para '{book_title}'...")
    system = "Eres un crítico literario de España. Responde SOLO con un array JSON. Usa español de España (castellano)."
    ctx = all_summaries[:15000]

    # Pasada 1: Protagonistas y Antagonistas (Detalle máximo)
    p1 = f"""Libro: {book_title}. Analiza a los PROTAGONISTAS y ANTAGONISTAS. 
    Esquema JSON obligatorio: 
    {{
      "name": "Nombre",
      "role": "protagonist o antagonist",
      "description": "Aspecto físico y origen",
      "personality": "Psicología detallada y miedos",
      "arc": "Evolución y cambios a lo largo de la novela",
      "relationships": {{"Personaje": "vínculo y evolución"}},
      "key_moments": ["momento memorable 1", "momento memorable 2"],
      "quotes": ["cita textual o frase representativa"]
    }}
    Info: {ctx}"""

    # Pasada 2: Secundarios (Más breve)
    p2 = f"""Libro: {book_title}. Analiza a los personajes SECUNDARIOS y menores.
    Esquema JSON: {{"name":"", "role":"secondary", "description":"breve", "personality":"breve"}}
    Info: {ctx}"""

    async def _safe_call(prompt, tokens):
        try:
            raw = await asyncio.wait_for(_call_ai(system, prompt, tokens), timeout=150)
            return _parse_json(raw) or []
        except: return []

    # Ejecutar pasadas
    principales = await _safe_call(p1, 4000)
    await asyncio.sleep(2) # Evitar saturar API
    secundarios = await _safe_call(p2, 2500)
    
    # Combinar y limpiar
    combined = []
    seen = set()
    for c in (principales + secundarios):
        if isinstance(c, dict) and c.get("name"):
            norm = c["name"].lower().strip()
            if norm not in seen:
                seen.add(norm)
                combined.append(c)
    return combined

async def generate_global_summary(all_summaries: str, book_title: str, author: str) -> str:
    system = "Eres un crítico literario de España. Escribe en español de España una reseña académica profunda (mínimo 800 palabras)."
    user = f"Libro: {book_title} de {author}. Resúmenes: {all_summaries[:25000]}"
    return await _call_ai(system, user, 4000)

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = "Experto en mapas mentales. Responde en español de España solo JSON."
    user = f"Mapa mental detallado para '{book_title}'. Ramas: Trama, Personajes, Temas, Escenarios, Símbolos, Estilo. Info: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 3000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except: return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title: str, author: str, summary: str, chars: list) -> str:
    system = "Guionista de podcast en España. Diálogos naturales en español de España entre ANA (analítica) y CARLOS (entusiasta)."
    user = f"Libro: {book_title}. Resumen: {summary[:8000]}. Personajes: {str(chars)[:1000]}"
    return await _call_ai(system, user, 4500)