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

async def _call_ai_with_retry(system: str, user: str, max_tokens: int = 2000, max_retries: int = 5) -> str:
    for attempt in range(max_retries):
        try:
            return await _call_ai(system, user, max_tokens)
        except Exception as e:
            if attempt == max_retries - 1:
                print(f"AI Call failed after {max_retries} attempts: {e}")
                raise
            err_str = str(e)
            sleep_time = (attempt + 1) * 4
            if "Rate limit" in err_str or "Too Many Requests" in err_str or "429" in err_str:
                sleep_time = 15 + (attempt * 10)  # Da tiempo a que se rellene la cuota de tokens por minuto
                print(f"Límite de API alcanzado. Defiriendo {sleep_time}s para recuperar cuota... (Intento {attempt+1}/{max_retries})")
            else:
                print(f"AI Call error temporal: {e}. Reintentando en {sleep_time}s... (Intento {attempt+1}/{max_retries})")
            await asyncio.sleep(sleep_time)

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
    system = (
        "Eres un erudito literario de España. Responde siempre en español de España culto. "
        "Responde SOLO con JSON válido, sin texto extra, usando exactamente estas claves en inglés:\n"
        '{"summary": "resumen extenso del capítulo (mínimo 250 palabras en español de España)", '
        '"key_events": ["Primer hito narrativo fundamental", "Segundo hito narrativo...", "Mínimo 3 hitos"]}'
    )
    user = (
        f"Libro: \u00ab{book_title}\u00bb de {author}.\n"
        f"Capítulo: \u00ab{chapter_title}\u00bb\n\n"
        f"Realiza un resumen magistral y minucioso del siguiente texto:\n{text[:9000]}"
    )
    try:
        raw = await _call_ai_with_retry(system, user, 2000)
        parsed = _parse_json(raw)
        if not parsed:
            return None
        # Normalizar claves españolas por si la IA no sigue el esquema
        if "summary" not in parsed:
            parsed["summary"] = (
                parsed.get("resumen") or
                parsed.get("contenido") or
                parsed.get("texto") or
                parsed.get("descripcion") or
                next((v for v in parsed.values() if isinstance(v, str) and len(v) > 100), None)
            )
        if "key_events" not in parsed:
            parsed["key_events"] = (
                parsed.get("eventos_clave") or
                parsed.get("eventos") or
                parsed.get("puntos_clave") or
                parsed.get("momentos_clave") or
                parsed.get("hitos") or
                parsed.get("key_moments") or
                []
            )
        # Limpieza básica: asegurar que sean strings y no estén vacíos
        if isinstance(parsed["key_events"], list):
            parsed["key_events"] = [str(x).strip() for x in parsed["key_events"] if x and len(str(x)) > 5]
        return parsed if parsed.get("summary") else None
    except Exception as e:
        print(f"Error al resumir capítulo {chapter_title}: {e}")
        return None

async def get_character_list(all_summaries: str) -> list:
    if not all_summaries or len(all_summaries.strip()) < 50:
        return []
    system = "Experto literario de España. Identifica TODOS los personajes con nombre propio. Responde SOLO array JSON: [{\"name\": \"...\", \"is_main\": true/false}]"
    user = f"Resúmenes: {all_summaries[:15000]}"
    try:
        raw = await _call_ai_with_retry(system, user, 1000)
        data = _parse_json(raw)
        return [c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else []
    except Exception as e:
        print(f"Error al obtener listado de personajes: {e}")
        return []

async def extract_key_events_from_summary(summary_text: str) -> list:
    if not summary_text or len(summary_text.strip()) < 50:
        return []
    system = (
        "Eres un experto en análisis literario de España. "
        "A partir del resumen de un capítulo que se te proporcionará, extrae exactamente entre 3 y 5 eventos clave (hitos narrativos fundamentes). "
        "Sé conciso y directo. Responde SOLO con un array JSON de strings: [\"Hito 1\", \"Hito 2\", ...]"
    )
    user = f"Resumen del capítulo:\n{summary_text}"
    try:
        raw = await _call_ai_with_retry(system, user, 600)
        data = _parse_json(raw)
        if isinstance(data, list):
            return [str(x).strip() for x in data if x and len(str(x)) > 5]
        return []
    except Exception as e:
        print(f"Error al extraer eventos clave del resumen: {e}")
        return []

async def analyze_single_character(name: str, is_main: bool, all_summaries: str, book_title: str) -> dict:
    if not all_summaries or len(all_summaries.strip()) < 50:
        return None
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
        raw = await _call_ai_with_retry(system, user, 3500)
        return _parse_json(raw)
    except Exception as e:
        print(f"Error al analizar personaje {name}: {e}")
        return None

async def generate_global_summary(all_summaries: str, book_title: str, author: str) -> str:
    if not all_summaries or len(all_summaries.strip()) < 50:
        return ""
    system = "Académico de la lengua de España. Escribe un ensayo literario magistral (mínimo 1500 palabras) en español de España."
    user = f"Libro: {book_title} de {author}. Análisis basado en: {all_summaries[:30000]}"
    try:
        return await _call_ai_with_retry(system, user, 5000)
    except Exception as e:
        print(f"Error al generar ensayo global: {e}")
        return ""

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    if not all_summaries or len(all_summaries.strip()) < 50:
        return {"center": book_title, "branches": []}
    system = (
        "Experto en análisis literario de alto nivel. Responde SOLO con JSON válido.\n"
        "Estructura exacta requerida:\n"
        '{"center": "Título", "branches": [{"label": "Nombre rama", "color": "#hexcolor", "children": ["texto 1", "texto 2", ...]}, ...]}\n'
        "Genera exactamente 8 ramas principales con estos nombres y colores:\n"
        "1. Trama principal (#4f46e5): Nudos narrativos fundamentales, de principio a fin.\n"
        "2. Subtramas (#06b6d4): Historias secundarias que complementan la acción.\n"
        "3. Personajes clave (#f59e0b): Perfiles psicológicos de los protagonistas.\n"
        "4. Relaciones entre personajes (#d4876b): Dinámicas, conflictos y lealtades.\n"
        "5. Temas y mensajes (#10b981): Ideas centrales, filosofía y subtexto.\n"
        "6. Escenarios y época (#ef4444): Ubicación geográfica, contexto histórico y atmósfera.\n"
        "7. Símbolos y leitmotivs (#ec4899): Objetos o frases que cobran significado especial.\n"
        "8. Estilo y técnica narrativa (#8b5cf6): Voz del autor, estructura temporal y prosa.\n"
        "Cada rama debe tener al menos 4-6 hijos con frases completas y profundas."
    )
    user = f"Genera el mapa mental completo para «{book_title}».\nContenido del libro:\n{all_summaries[:20000]}"
    try:
        raw = await _call_ai_with_retry(system, user, 5000)
        return _parse_json(raw) or {"center": book_title, "branches": []}
    except:
        return {"center": book_title, "branches": []}

async def generate_podcast_script(book_title, author, summary, chars) -> str:
    if not summary or len(summary.strip()) < 50:
        return ""
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
    try:
        return await _call_ai_with_retry(system, user, 8000)
    except Exception as e:
        print(f"Error al generar guion de podcast: {e}")
        return ""