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
        payload = {"contents": [{"parts": [{"text": f"{system}\n\n{user}"}]}], "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.5}}
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(url, json=payload)
            if r.status_code != 200: raise ValueError(f"Gemini Error: {r.text}")
            return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    else:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        resp = await client.chat.completions.create(model=settings.AI_MODEL, max_tokens=max_tokens, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
        return resp.choices[0].message.content

def _parse_json(text: str):
    if not text: return None
    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()
    try: return json.loads(clean)
    except:
        match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', clean)
        if match:
            try: return json.loads(match.group())
            except: return None
    return None

# --- FUNCIONES DE ALTA INTENSIDAD ---

async def summarize_chapter(chapter_title, text, book_title, author) -> dict:
    system = "Erudito literario de España. Responde en español de España culto (Castellano). JSON obligatorio."
    user = f"Libro: {book_title}. Capítulo: {chapter_title}. Realiza un resumen magistral y minucioso: {text[:9000]}"
    try:
        raw = await _call_ai(system, user, 2000)
        return _parse_json(raw) or {"summary": raw, "key_events": []}
    except: return {"summary": "Error", "key_events": []}

async def get_character_list(all_summaries: str) -> list:
    system = "Experto literario de España. Identifica TODOS los personajes con nombre propio. Responde SOLO array JSON: [{\"name\": \"...\", \"is_main\": true/false}]"
    user = f"Resúmenes: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 1000)
        data = _parse_json(raw)
        return [c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else []
    except: return []

async def analyze_single_character(name: str, is_main: bool, all_summaries: str, book_title: str) -> dict:
    tipo = "PRINCIPAL" if is_main else "SECUNDARIO"
    system = f"Eres un crítico literario de la RAE de España. Realiza un estudio psicológico MONUMENTAL de este personaje {tipo}. Usa castellano culto de España. Responde SOLO en JSON."
    user = f"""Libro: {book_title}. Personaje: {name}. 
    Analiza con ambición máxima (mínimo 1000 palabras) usando resúmenes: {all_summaries[:18000]}
    Esquema JSON obligatorio:
    {{
      "name": "{name}",
      "role": "Análisis profundo de su función en la trama",
      "description": "Retrato físico detallado (mínimo 150 palabras)",
      "personality": "Psicología, miedos y valores (mínimo 250 palabras)",
      "arc": "Evolución y transformación vital (mínimo 250 palabras)",
      "relationships": {{"Nombre": "Análisis extenso de la relación"}},
      "key_moments": ["Momento 1 detallado", "Momento 2 detallado"],
      "quotes": ["Cita clave"]
    }}"""
    try:
        raw = await _call_ai(system, user, 3500)
        return _parse_json(raw)
    except: return None

async def generate_global_summary(all_summaries: str, book_title: str, author: str) -> str:
    system = "Académico de la lengua de España. Escribe un ensayo literario magistral (mínimo 1500 palabras) en español de España."
    user = f"Libro: {book_title} de {author}. Análisis basado en: {all_summaries[:30000]}"
    return await _call_ai(system, user, 5000)

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = (
        "Experto en análisis literario. Responde SOLO con JSON válido, sin texto extra ni bloques de código.\n"
        "Estructura exacta requerida:\n"
        '{"center": "Título", "branches": [{"label": "Nombre rama", "color": "#hexcolor", "children": ["texto completo del nodo hijo 1", "texto completo del nodo hijo 2"]}, ...]}\n'
        "Genera 6 ramas: Trama, Personajes, Temas, Escenarios, Simbolismo, Técnica Narrativa.\n"
        "Cada rama debe tener entre 4 y 8 hijos. Los textos de los hijos deben ser frases completas y descriptivas (no cortes de 2 palabras).\n"
        "Colores sugeridos: Trama=#c9a96e, Personajes=#7c9e87, Temas=#8b7fb8, Escenarios=#d4876b, Simbolismo=#5f8ea0, Técnica=#c97b8a"
    )
    user = f"Genera el mapa mental completo para «{book_title}».\nContenido del libro:\n{all_summaries[:20000]}"
    try:
        raw = await _call_ai(system, user, 5000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except:
        return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title, author, summary, chars) -> str:
    system = (
        "Eres guionista de un podcast literario de RNE. Escribe en español de España.\n"
        "El podcast dura exactamente 5 minutos de audio (≈ 750–850 palabras de diálogo real).\n"
        "Formato OBLIGATORIO — cada línea empieza con el nombre del locutor en mayúsculas seguido de dos puntos:\n"
        "ANA: [texto]\n"
        "CARLOS: [texto]\n"
        "Solo ANA y CARLOS hablan. Sin secciones, sin títulos, sin acotaciones, sin texto narrador.\n"
        "La conversación debe ser natural, intelectual y amena. Incluye:\n"
        "1) Presentación del libro y autor\n"
        "2) Trama principal sin spoilers hasta el 70%\n"
        "3) Personajes más importantes y su evolución\n"
        "4) Temas y simbolismo\n"
        "5) Valoración personal de ANA y CARLOS\n"
        "6) Recomendación final al oyente\n"
        "Genera exactamente entre 30 y 40 intervenciones alternadas."
    )
    user = (
        f"Libro: «{book_title}» de {author}.\n"
        f"Análisis del libro:\n{summary[:10000]}\n\n"
        f"Personajes principales:\n{str(chars)[:2000]}"
    )
    return await _call_ai(system, user, 8000)