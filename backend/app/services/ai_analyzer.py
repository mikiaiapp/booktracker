import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings

async def _call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    m = settings.AI_MODEL.lower()
    # Timeout extendido a 10 minutos para permitir análisis muy extensos
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
    system = "Eres un experto literario de España. Escribe en español de España culto. Responde solo en JSON."
    user = f"Libro: {book_title}. Capítulo: {chapter_title}. Realiza un resumen exhaustivo y profundo del siguiente texto, analizando los giros narrativos: {text[:9000]}"
    try:
        raw = await _call_ai(system, user, 2000)
        return _parse_json(raw) or {"summary": raw, "key_events": []}
    except: return {"summary": "Error en el análisis", "key_events": []}

async def analyze_characters(all_summaries: str, book_title: str) -> list:
    """Análisis literario de máxima ambición y detalle."""
    print(f">>> [IA] Iniciando análisis AMBICIOSO de personajes para '{book_title}'...")
    system = "Eres un crítico literario de la RAE. Tu análisis debe ser extenso, profundo, ambicioso y erudito. Usa español de España (castellano culto). Responde SOLO con un array JSON."
    ctx = all_summaries[:18000]

    p1 = f"""Libro: {book_title}. 
    Realiza un estudio psicológico y narrativo EXHAUSTIVO de los PROTAGONISTAS y ANTAGONISTAS. 
    Para cada personaje, desarrolla:
    - name: Nombre completo.
    - role: Rol narrativo detallado.
    - description: Retrato físico y orígenes detallados (mínimo 4 frases).
    - personality: Análisis profundo de su psique, virtudes, defectos y miedos internos (mínimo 6 frases).
    - arc: Estudio pormenorizado de su evolución, transformación y cambios de paradigma a lo largo de la obra (mínimo 6 frases).
    - relationships: Ensayo sobre sus vínculos con otros personajes, tensiones, lealtades y conflictos.
    - key_moments: Crónica detallada de sus 4 momentos más definitorios en la trama.
    - quotes: Sus citas más memorables o pensamientos filosóficos representativos.
    
    Info del libro: {ctx}"""

    p2 = f"""Libro: {book_title}. 
    Analiza de forma DETALLADA a los personajes SECUNDARIOS y menores. No escatimes en palabras. 
    Describe su función, personalidad y relevancia en la trama con profundidad académica.
    Esquema JSON: {{"name":"", "role":"secondary", "description":"", "personality":"", "arc": "", "relationships": {{}}}}
    Info: {ctx}"""

    async def _safe_call(prompt, tokens):
        try:
            # Timeout de 420 segundos para cada llamada a la IA
            raw = await asyncio.wait_for(_call_ai(system, prompt, tokens), timeout=420)
            return _parse_json(raw) or []
        except Exception as e:
            print(f"Error en llamada de personajes: {e}")
            return []

    principales = await _safe_call(p1, 6000)
    await asyncio.sleep(3)
    secundarios = await _safe_call(p2, 4000)
    
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
    system = "Eres un académico de la lengua española. Escribe una reseña literaria magistral, profunda y exhaustiva (mínimo 1000 palabras) en español de España."
    user = f"Libro: {book_title} de {author}. Basándote en estos resúmenes: {all_summaries[:30000]}, escribe el análisis definitivo de la obra."
    return await _call_ai(system, user, 4500)

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = "Experto en mapas mentales literarios. Usa español de España culto. Responde solo JSON."
    user = f"Genera un mapa mental extremadamente detallado para '{book_title}'. Incluye ramas para: Trama Compleja, Psicología de Personajes, Temas Filosóficos, Escenarios y Atmósfera, Simbolismo y Metáforas, Técnica Narrativa y Estilo. Info: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 4000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except: return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title: str, author: str, summary: str, chars: list) -> str:
    system = "Guionista de programas culturales en Radio Nacional de España. Diálogos intelectuales pero cercanos en español de España entre ANA y CARLOS."
    user = f"Libro: {book_title}. Análisis: {summary[:8000]}. Personajes principales: {str(chars)[:1500]}. Crea un guion de podcast profundo de 20 minutos."
    return await _call_ai(system, user, 5000)