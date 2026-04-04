import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings

async def _call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    m = settings.AI_MODEL.lower()
    timeout = httpx.Timeout(600.0, connect=10.0)
    
    if "gemini" in m:
        api_key = settings.GEMINI_API_KEY or os.environ.get("GEMINI_API_KEY")
        url = f"https://generativelanguage.googleapis.com/v1/models/{settings.AI_MODEL}:generateContent?key={api_key}"
        payload = {
            "contents": [{"parts": [{"text": f"{system}\n\n{user}"}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.5}
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

# --- ANALISIS AMBICIOSO ---

async def analyze_characters(all_summaries: str, book_title: str) -> list:
    """Análisis masivo y ultra-detallado de TODOS los personajes."""
    print(f">>> [IA] Iniciando análisis enciclopédico de personajes para '{book_title}'...")
    system = "Eres un académico de la RAE y el crítico literario más prestigioso de España. Tu análisis debe ser extenso, erudito y de una ambición literaria máxima. Usa español de España culto (castellano)."
    ctx = all_summaries[:20000]

    # Esquema para personajes principales (Máximo detalle)
    schema_full = """{
      "name": "Nombre completo y títulos",
      "role": "Análisis detallado del rol narrativo",
      "description": "Retrato físico, vestimenta y presencia (mínimo 100 palabras)",
      "personality": "Estudio psicológico profundo, miedos, virtudes y contradicciones (mínimo 150 palabras)",
      "arc": "Evolución pormenorizada y transformación vital en la obra (mínimo 150 palabras)",
      "relationships": ["Relación detallada con X: (mínimo 3 frases)", "Relación detallada con Y: ..."],
      "key_moments": ["Crónica extensa del momento clave 1", "Crónica extensa del momento clave 2"],
      "quotes": ["Cita memorable 1 con contexto", "Cita memorable 2"]
    }"""

    # PASADA 1: Protagonistas y Antagonistas
    p1 = f"Libro: {book_title}. Realiza un estudio psicológico magistral de TODOS los PROTAGONISTAS y ANTAGONISTAS. Es obligatorio que no omitas a ninguno. Usa este esquema: {schema_full}\nInfo: {ctx}"
    
    # PASADA 2: Secundarios y Menores
    p2 = f"Libro: {book_title}. Analiza de forma EXTENSA a TODOS los personajes SECUNDARIOS y menores que aparezcan. No te dejes a ninguno fuera. Usa este esquema (pero adaptado a secundarios): {schema_full}\nInfo: {ctx}"

    async def _safe_call(prompt, tokens):
        try:
            raw = await asyncio.wait_for(_call_ai(system, prompt, tokens), timeout=480)
            return _parse_json(raw) or []
        except: return []

    # Llamadas independientes para evitar saturación de tokens
    principales = await _safe_call(p1, 6500)
    await asyncio.sleep(5)
    secundarios = await _safe_call(p2, 6000)
    
    combined = []
    seen = set()
    for c in (principales + secundarios):
        if isinstance(c, dict) and c.get("name"):
            norm = c["name"].lower().strip()
            if norm not in seen:
                seen.add(norm)
                combined.append(c)
    return combined

async def summarize_chapter(chapter_title, text, book_title, author) -> dict:
    system = "Experto literario de España. Responde en español de España culto solo en JSON."
    user = f"Libro: {book_title}. Capítulo: {chapter_title}. Resume con maestría: {text[:9000]}"
    try:
        raw = await _call_ai(system, user, 1800)
        return _parse_json(raw) or {"summary": raw, "key_events": []}
    except: return {"summary": "Error", "key_events": []}

async def generate_global_summary(all_summaries, book_title, author) -> str:
    system = "Académico de la lengua. Escribe un ensayo literario magistral (mínimo 1200 palabras) en español de España."
    user = f"Libro: {book_title}. Análisis basado en: {all_summaries[:30000]}"
    return await _call_ai(system, user, 5000)

async def generate_mindmap(all_summaries, book_title) -> dict:
    system = "Experto en mapas mentales. Responde en español de España solo JSON."
    user = f"Mapa mental extensísimo para '{book_title}'. Info: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 4000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except: return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title, author, summary, chars) -> str:
    system = "Guionista de RNE. Diálogos intelectuales en español de España entre ANA y CARLOS."
    user = f"Libro: {book_title}. Análisis: {summary[:8000]}. Personajes: {str(chars)[:1500]}"
    return await _call_ai(system, user, 5000)