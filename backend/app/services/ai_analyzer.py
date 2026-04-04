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

# --- FUNCIONES ACTUALIZADAS ---

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    """Genera un mapa mental detallado con estructura JSON estricta."""
    print(f">>> [IA] Generando Mapa Mental para '{book_title}'...")
    system = "Eres un experto en mapas mentales literarios de España. Responde ÚNICAMENTE con JSON válido en español de España."
    
    # Definimos colores y estructura para asegurar que el frontend lo pinte bien
    user = f"""Libro: {book_title}
Basándote en: {all_summaries[:20000]}

Genera un JSON con esta estructura exacta:
{{
  "center": "{book_title}",
  "branches": [
    {{ "label": "Trama Compleja", "color": "#6366f1", "children": ["Detalle extenso 1", "Detalle extenso 2"] }},
    {{ "label": "Psicología de Personajes", "color": "#f59e0b", "children": ["Análisis X", "Análisis Y"] }},
    {{ "label": "Temas Filosóficos", "color": "#10b981", "children": ["Tema 1", "Tema 2"] }},
    {{ "label": "Escenarios y Atmósfera", "color": "#ef4444", "children": ["Lugar A", "Lugar B"] }},
    {{ "label": "Simbolismo y Metáforas", "color": "#ec4899", "children": ["Símbolo 1", "Símbolo 2"] }},
    {{ "label": "Estilo Narrativo", "color": "#8b5cf6", "children": ["Técnica 1", "Técnica 2"] }}
  ]
}}
Es vital que cada rama tenga al menos 6-8 'children' muy detallados."""
    try:
        raw = await _call_ai(system, user, 4000)
        data = _parse_json(raw)
        if data and "branches" in data:
            return data
        return {"center": book_title, "branches": []}
    except:
        return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title, author, summary, chars) -> str:
    """Guion de alta calidad para Podcast."""
    system = "Eres el mejor guionista de Radio Nacional de España. Diálogos intelectuales, fluidos y naturales en español de España entre ANA (crítica literaria) y CARLOS (lector apasionado)."
    user = f"""Libro: {book_title} de {author}.
Análisis global: {summary[:8000]}.
Fichas de personajes: {str(chars)[:1500]}.

Tarea: Escribe un guion de podcast de 20 minutos. 
Formato OBLIGATORIO: 
ANA: [texto]
CARLOS: [texto]

Estructura: Bienvenida, análisis de la trama, debate sobre la psicología de los personajes, mensaje del autor y despedida. Evita frases genéricas, habla con profundidad académica."""
    return await _call_ai(system, user, 5500)

# El resto de funciones (summarize, analyze_single_character, get_character_list) se mantienen iguales
async def get_character_list(all_summaries: str) -> list:
    system = "Experto literario. Identifica TODOS los personajes con nombre propio. Responde SOLO un array JSON: [{\"name\": \"...\", \"is_main\": true/false}]"
    user = f"Resúmenes: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 1000)
        return _parse_json(raw) or []
    except: return []

async def analyze_single_character(name: str, is_main: bool, all_summaries: str, book_title: str) -> dict:
    tipo = "PRINCIPAL" if is_main else "SECUNDARIO"
    system = f"Eres un crítico literario de la RAE. Realiza un estudio psicológico y narrativo MONUMENTAL de este personaje {tipo}. Usa español de España culto. Responde SOLO en JSON."
    user = f"Libro: {book_title}. Personaje: {name}. Analiza a fondo usando: {all_summaries[:18000]}"
    try:
        raw = await _call_ai(system, user, 3500)
        return _parse_json(raw)
    except: return None

async def summarize_chapter(chapter_title, text, book_title, author) -> dict:
    system = "Experto literario de España. Responde en español de España culto solo en JSON."
    user = f"Libro: {book_title}. Capítulo: {chapter_title}. Resumen magistral: {text[:9000]}"
    try:
        raw = await _call_ai(system, user, 1800)
        return _parse_json(raw) or {"summary": raw, "key_events": []}
    except: return {"summary": "Error", "key_events": []}

async def generate_global_summary(all_summaries, book_title, author) -> str:
    system = "Académico de la lengua. Escribe un ensayo literario magistral (mínimo 1500 palabras) en español de España."
    user = f"Libro: {book_title}. Análisis basado en: {all_summaries[:30000]}"
    return await _call_ai(system, user, 5000)