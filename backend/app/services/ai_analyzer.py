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

# --- FUNCIONES DE ANALISIS ---

async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: str) -> dict:
    system = "Eres un erudito literario de España. Responde en español de España culto. JSON obligatorio."
    user = f"Libro: {book_title}. Capítulo: {chapter_title}. Realiza un resumen magistral y minucioso: {text[:9000]}"
    try:
        raw = await _call_ai(system, user, 2000)
        return _parse_json(raw) or {"summary": raw, "key_events": []}
    except: return {"summary": "Error", "key_events": []}

async def analyze_characters(all_summaries: str, book_title: str) -> list:
    """Análisis exhaustivo de TODOS los personajes sin excepciones."""
    print(f">>> [IA] Iniciando estudio pormenorizado de TODOS los personajes de '{book_title}'...")
    system = "Eres un académico de la RAE y crítico literario de España. Tu análisis debe ser ambicioso, extenso y erudito. Usa castellano de España puro. Responde SOLO con un array JSON."
    ctx = all_summaries[:18000]

    # Pasada 1: PROTAGONISTAS Y ANTAGONISTAS (Máximo detalle posible)
    p1 = f"""Libro: {book_title}. 
    Analiza a TODOS los protagonistas y antagonistas principales. No te dejes a ninguno.
    Para cada uno, redacta un análisis profundo con los siguientes campos:
    - name: Nombre completo.
    - role: Rol narrativo (ej. Protagonista absoluto, Antagonista trágico, etc.).
    - description: Retrato físico, indumentaria y orígenes (mínimo 6 frases).
    - personality: Estudio psicológico profundo, virtudes, defectos, miedos y contradicciones (mínimo 8 frases).
    - arc: Evolución, madurez y transformación espiritual o ideológica a lo largo de la obra (mínimo 8 frases).
    - relationships: Ensayo detallado sobre sus vínculos con los demás personajes (mínimo 5 frases).
    - key_moments: Crónica pormenorizada de sus momentos más críticos y definitorios.
    - quotes: Citas textuales o pensamientos memorables.
    
    Info: {ctx}"""

    # Pasada 2: SECUNDARIOS Y MENORES (Detalle intenso pero optimizado para cantidad)
    p2 = f"""Libro: {book_title}. 
    Analiza a TODOS los personajes secundarios y menores mencionados en los resúmenes. Es vital que no omitas a ninguno que tenga nombre o función.
    Desarrolla su ficha con intensidad académica:
    - name: Nombre.
    - role: Función específica (ej. Aliado, mentor, obstáculo, etc.).
    - description: Descripción física y contexto.
    - personality: Rasgos de carácter y motivaciones.
    - arc: Su pequeña contribución o cambio si lo hubiera.
    - relationships: Vínculos con los protagonistas.
    
    Info: {ctx}"""

    async def _safe_call(prompt, tokens):
        try:
            raw = await asyncio.wait_for(_call_ai(system, prompt, tokens), timeout=450)
            return _parse_json(raw) or []
        except Exception as e:
            print(f"Error en fase de personajes: {e}")
            return []

    # Ejecutar ambas pasadas con alto límite de tokens
    principales = await _safe_call(p1, 6000)
    await asyncio.sleep(4) 
    secundarios = await _safe_call(p2, 5000)
    
    combined = []
    seen = set()
    # Unimos y priorizamos la información de la primera pasada si hay duplicados
    for c in (principales + secundarios):
        if isinstance(c, dict) and c.get("name"):
            norm = re.sub(r"\s+", "", c["name"].lower().strip())
            if norm not in seen:
                seen.add(norm)
                combined.append(c)
                
    return combined

async def generate_global_summary(all_summaries: str, book_title: str, author: str) -> str:
    system = "Crítico literario de España. Escribe una reseña académica magistral y exhaustiva (mínimo 1200 palabras) en castellano culto."
    user = f"Libro: {book_title}. Análisis definitivo basado en estos resúmenes: {all_summaries[:30000]}"
    return await _call_ai(system, user, 4500)

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = "Experto en mapas mentales. Usa español de España. Responde solo JSON."
    user = f"Mapa mental extensísimo para '{book_title}'. Ramas: Trama Compleja, Personajes, Temas Filosóficos, Escenarios, Simbolismo, Técnica Narrativa. Info: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 4000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except: return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title: str, author: str, summary: str, chars: list) -> str:
    system = "Guionista de RNE (Radio Nacional de España). Diálogos cultos pero fluidos entre ANA y CARLOS."
    user = f"Libro: {book_title}. Análisis profundo: {summary[:8000]}. Personajes: {str(chars)[:1500]}."
    return await _call_ai(system, user, 5000)