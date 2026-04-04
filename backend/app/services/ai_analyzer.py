"""
AI analysis service optimizado.
Maneja la comunicación con proveedores de IA y el parseo de JSON truncados.
"""
import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings


def _provider() -> str:
    m = settings.AI_MODEL.lower()
    if "gemini" in m:
        return "gemini"
    if "claude" in m:
        return "claude"
    return "openai"


async def _call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    p = _provider()
    if p == "gemini":
        return await _call_gemini(system, user, max_tokens)
    if p == "claude":
        return await _call_claude(system, user, max_tokens)
    return await _call_openai(system, user, max_tokens)


async def _call_gemini(system: str, user: str, max_tokens: int) -> str:
    api_key = (
        settings.GEMINI_API_KEY
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )
    if not api_key:
        raise ValueError("Configura GEMINI_API_KEY")

    url = f"https://generativelanguage.googleapis.com/v1/models/{settings.AI_MODEL}:generateContent?key={api_key}"
    combined = f"{system}\n\n{user}"
    payload = {
        "contents": [{"parts": [{"text": combined}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3},
    }

    max_retries = 3
    for attempt in range(max_retries):
        async with httpx.AsyncClient(timeout=150) as client:
            r = await client.post(url, json=payload)

        if r.status_code == 200:
            data = r.json()
            try:
                return data["candidates"][0]["content"]["parts"][0]["text"]
            except:
                raise ValueError(f"Respuesta inesperada de Gemini: {data}")
        elif r.status_code == 429:
            if attempt < max_retries - 1:
                await asyncio.sleep(20 * (attempt + 1))
                continue
            raise ValueError("QUOTA_EXCEEDED:24:00")
        else:
            raise ValueError(f"Gemini API error {r.status_code}: {r.text}")


async def _call_claude(system: str, user: str, max_tokens: int) -> str:
    import anthropic
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
    msg = await client.messages.create(
        model=settings.AI_MODEL,
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    return msg.content[0].text


async def _call_openai(system: str, user: str, max_tokens: int) -> str:
    from openai import AsyncOpenAI, RateLimitError
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY, timeout=150.0)
    try:
        resp = await client.chat.completions.create(
            model=settings.AI_MODEL,
            max_tokens=max_tokens,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        return resp.choices[0].message.content
    except RateLimitError:
        raise ValueError("QUOTA_EXCEEDED:0:01")


def _clean_summary(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = re.sub(r'\\"([^"]+)\\"', r'"\1"', text)
    text = text.replace("\\n", "\n")
    text = re.sub(r'^\{\s*"summary"\s*:\s*"?', "", text)
    text = re.sub(r'"?\s*,?\s*"key_events".*$', "", text, flags=re.DOTALL)
    return text.strip().strip('"')


def _parse_json(text: str) -> dict | list:
    if not text:
        raise ValueError("Respuesta vacia")
    
    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()
    
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass

    # Intento de recuperación por regex si el JSON está truncado
    bracket = clean.find("[")
    if bracket != -1:
        match = re.search(r'\[[\s\S]*\]', clean[bracket:])
        if match:
            try: return json.loads(match.group())
            except: pass
            
    obj_match = re.search(r'\{[\s\S]*\}', clean)
    if obj_match:
        try: return json.loads(obj_match.group())
        except: pass

    raise ValueError(f"No se pudo parsear JSON.")


# ── FUNCIONALIDADES ──

async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: Optional[str]) -> dict:
    system = "Eres un experto literario. Responde UNICAMENTE con JSON valido."
    user = f"""Libro: "{book_title}" de {author or "autor"}
Capitulo: "{chapter_title}"
Texto: {text[:9000]}
JSON Requerido: {{"summary": "Resumen detallado", "key_events": ["evento 1"]}}"""
    
    result = await _call_ai(system, user, max_tokens=1500)
    try:
        data = _parse_json(result)
        if isinstance(data, dict) and "summary" in data:
            data["summary"] = _clean_summary(data["summary"])
        return data
    except:
        return {"summary": _clean_summary(result), "key_events": []}


async def analyze_characters(all_summaries: str, book_title: str) -> list:
    """Análisis en dos pasadas optimizado para no cortar el JSON."""
    system = "Experto literario. Responde SOLO con un array JSON. Se conciso para evitar truncamientos."
    ctx = all_summaries[:12000]

    # Pasada 1: Principales
    p1 = f"""Libro: "{book_title}"
Resumenes: {ctx}
TAREA: Array JSON de protagonistas y antagonistas. 
Esquema: {{"name":"","aliases":[],"role":"protagonist","description":"","personality":"","key_moments":[],"relationships":{{}}}}"""

    # Pasada 2: Secundarios
    p2 = f"""Libro: "{book_title}"
Resumenes: {ctx}
TAREA: Array JSON de personajes secundarios y menores. 
Esquema: {{"name":"","role":"secondary","description":"breve funcion en trama"}}"""

    async def _safe_call(prompt, tokens):
        try:
            raw = await asyncio.wait_for(_call_ai(system, prompt, max_tokens=tokens), timeout=180)
            return _parse_json(raw)
        except:
            return []

    res1 = await _safe_call(p1, 3500)
    await asyncio.sleep(2)
    res2 = await _safe_call(p2, 2500)
    
    combined = []
    seen = set()
    for char in (res1 + res2):
        if not isinstance(char, dict) or not char.get("name"): continue
        norm = re.sub(r"\s+", "", char["name"].lower())
        if norm not in seen:
            seen.add(norm)
            combined.append(char)
    return combined


async def generate_global_summary(all_summaries: str, book_title: str, author: Optional[str]) -> str:
    system = "Eres un critico literario experto. Genera analisis exhaustivos en espanol."
    user = f"""Libro: "{book_title}" de {author}
Resumenes: {all_summaries[:25000]}
Escribe un resumen global exhaustivo (minimo 800 palabras) con trama, personajes, temas y valoracion critica."""
    return await _call_ai(system, user, max_tokens=4000)


async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = "Experto en mapas mentales. Responde UNICAMENTE con JSON valido."
    user = f"Genera un mapa mental JSON detallado para '{book_title}' basado en: {all_summaries[:20000]}. Usa 8 ramas obligatorias: Trama, Subtramas, Personajes, Relaciones, Temas, Escenarios, Simbolos, Estilo."
    try:
        raw = await _call_ai(system, user, max_tokens=3500)
        return _parse_json(raw)
    except:
        return {"center": book_title, "branches": []}


async def generate_podcast_script(book_title: str, author: Optional[str], global_summary: str, characters: list) -> str:
    system = "Guionista de podcast literario. Conversacion entre ANA (analitica) y CARLOS (entusiasta). Formato ANA: [texto] / CARLOS: [texto]"
    user = f"""Libro: "{book_title}" de {author}
Resumen: {global_summary[:8000]}
Personajes: {str(characters)[:1000]}
Crea un guion completo de 15-20 min con intro, trama, analisis y conclusion."""
    return await _call_ai(system, user, max_tokens=5000)