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
    system = "Experto en mapas mentales literarios de España. Responde solo JSON."
    user = f"Genera el mapa mental definitivo y más extenso para '{book_title}'. Incluye ramas para: Trama, Personajes, Temas, Escenarios, Simbolismo y Técnica Narrativa. Info: {all_summaries[:20000]}"
    try:
        raw = await _call_ai(system, user, 4000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except: return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title, author, summary, chars) -> str:
    system = "Guionista de RNE. Diálogos intelectuales en español de España entre ANA y CARLOS. Formato ANA: [texto] / CARLOS: [texto]"
    user = f"Libro: {book_title}. Análisis: {summary[:8000]}. Personajes: {str(chars)[:1500]}"
    return await _call_ai(system, user, 5500)