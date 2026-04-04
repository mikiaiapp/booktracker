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

# --- ESTRATEGIA DE ANÁLISIS PROFUNDO ---

async def get_character_list(all_summaries: str) -> list:
    """Obtiene solo los nombres y roles de todos los personajes detectados."""
    system = "Eres un experto literario. Identifica TODOS los personajes (principales y secundarios). Responde SOLO un array JSON: [{\"name\": \"...\", \"is_main\": true/false}]"
    user = f"Resúmenes del libro: {all_summaries[:15000]}"
    try:
        raw = await _call_ai(system, user, 1000)
        return _parse_json(raw) or []
    except: return []

async def analyze_single_character(name: str, is_main: bool, all_summaries: str, book_title: str) -> dict:
    """Análisis masivo de UN solo personaje."""
    tipo = "PROTAGONISTA" if is_main else "SECUNDARIO"
    system = f"Eres un académico de la RAE. Realiza un estudio psicológico y narrativo magistral de este personaje {tipo}. Usa español de España culto. Responde SOLO en JSON."
    
    user = f"""Libro: {book_title}
Personaje a analizar: {name}

Basándote en estos resúmenes: {all_summaries[:15000]}
Genera un análisis enciclopédico con este formato JSON:
{{
  "name": "{name}",
  "role": "Análisis exhaustivo de su rol y función",
  "description": "Retrato físico y orígenes detallados (mínimo 150 palabras)",
  "personality": "Estudio profundo de su psique, miedos y valores (mínimo 200 palabras)",
  "arc": "Evolución vital y transformación en la novela (mínimo 200 palabras)",
  "relationships": {{"Nombre Personaje": "Descripción ensayística del vínculo"}},
  "key_moments": ["Crónica extensa del momento 1", "Crónica extensa del momento 2"],
  "quotes": ["Cita o pensamiento clave"]
}}"""
    try:
        raw = await _call_ai(system, user, 3000)
        return _parse_json(raw)
    except: return None

# --- RESTO DE FUNCIONES ---

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