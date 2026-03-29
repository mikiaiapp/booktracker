"""
AI analysis service.
Proveedores soportados via AI_MODEL:
  - gemini-2.0-flash  → Google Gemini via API REST (gratuito)
  - claude-*          → Anthropic Claude
  - gpt-4o / gpt-*    → OpenAI
"""
import json
import re
import os
import httpx
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
    """Llama a Gemini via API REST (evita problemas de cuota del cliente gRPC)."""
    api_key = (
        settings.GEMINI_API_KEY
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )
    if not api_key:
        raise ValueError("Configura GEMINI_API_KEY en las variables de entorno de Portainer")

    url = f"https://generativelanguage.googleapis.com/v1/models/{settings.AI_MODEL}:generateContent?key={api_key}"

    # En API v1, system_instruction no está soportado en todos los modelos.
    # Lo concatenamos directamente con el contenido del usuario.
    combined = f"{system}\n\n{user}"
    payload = {
        "contents": [{"parts": [{"text": combined}]}],
        "generationConfig": {
            "maxOutputTokens": max_tokens,
            "temperature": 0.3,
        },
    }

    import asyncio
    # Reintentos automáticos con espera exponencial para límites de cuota (429)
    max_retries = 4
    for attempt in range(max_retries):
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json=payload)

        if r.status_code == 200:
            data = r.json()
            break
        elif r.status_code == 429:
            if attempt < max_retries - 1:
                try:
                    retry_secs = float(
                        r.json()["error"]["details"][-1].get("retryDelay", "60s")
                        .replace("s", "")
                    )
                except Exception:
                    retry_secs = 60
                wait = min(retry_secs + (attempt * 15), 120)
                print(f"Gemini 429 — esperando {wait:.0f}s antes de reintentar ({attempt+1}/{max_retries})")
                await asyncio.sleep(wait)
                continue
            # Calcular hora de reset (medianoche UTC)
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            reset = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            hours_left = int((reset - now).total_seconds() // 3600)
            mins_left = int(((reset - now).total_seconds() % 3600) // 60)
            raise ValueError(f"QUOTA_EXCEEDED:{hours_left}:{mins_left}")
        else:
            raise ValueError(f"Gemini API error {r.status_code}: {r.text}")

    try:
        return data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError) as e:
        raise ValueError(f"Respuesta inesperada de Gemini: {data}") from e


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
    from openai import AsyncOpenAI
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    resp = await client.chat.completions.create(
        model=settings.AI_MODEL,
        max_tokens=max_tokens,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content


def _clean_summary(text: str) -> str:
    """Limpia un texto de resumen eliminando artefactos comunes de LLMs."""
    if not text:
        return text
    # Quitar bloques markdown
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    # Quitar escapes de comillas tipo \"titulo\"
    text = re.sub(r'\\"([^"]+)\\"', r'""', text)
    text = re.sub(r'\"', '"', text)
    # Normalizar \n y \n\n a saltos de línea reales
    text = text.replace("\\n\\n", "\n\n")
    text = text.replace("\\n", "\n")
    text = text.replace("\n\n", "\n\n")
    text = text.replace("\n", " ")
    # Eliminar { "summary": " del inicio si Gemini devuelve JSON incompleto
    text = re.sub(r'^\{\s*"summary"\s*:\s*"?', "", text)
    text = re.sub(r'"?\s*,?\s*"key_events".*$', "", text, flags=re.DOTALL)
    # Limpiar espacios múltiples
    text = re.sub(r"  +", " ", text)
    return text.strip().strip('"')


def _clean_text(text: str) -> str:
    """Limpia texto de artefactos JSON, markdown y escapes innecesarios."""
    # Eliminar bloques de código markdown
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    # Eliminar escapes de comillas innecesarios fuera de JSON
    text = text.replace('\"', '"')
    # Normalizar saltos de línea múltiples
    text = re.sub(r"\n\n+", "\n\n", text)
    text = re.sub(r"\n", " ", text)
    return text.strip()


def _parse_json(text: str) -> dict | list:
    # Eliminar bloques markdown
    clean = re.sub(r"```json\s*|```\s*", "", text).strip()
    # Intentar parsear directamente
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass
    # Intentar extraer el primer objeto o array JSON del texto
    for pattern in [r'\{[\s\S]*\}', r'\[[\s\S]*\]']:
        match = re.search(pattern, clean)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                continue
    raise ValueError(f"No se pudo parsear JSON: {clean[:200]}")


# ── Resumen de capítulo ───────────────────────────────────────
async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: Optional[str]) -> dict:
    system = """Eres un experto literario que crea resúmenes detallados con spoilers completos.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código."""

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}
Capítulo: "{chapter_title}"

Texto:
{text[:10000]}

JSON requerido:
{{
  "summary": "Resumen detallado (150-250 palabras)",
  "key_events": ["evento 1", "evento 2"]
}}"""

    result = await _call_ai(system, user, max_tokens=2000)
    try:
        data = _parse_json(result)
        if isinstance(data, dict):
            if "summary" in data:
                data["summary"] = _clean_summary(data["summary"])
            if "key_events" in data:
                data["key_events"] = [_clean_summary(e) for e in data["key_events"]]
        return data
    except Exception:
        return {"summary": _clean_summary(result), "key_events": []}


# ── Análisis de personajes ────────────────────────────────────
async def analyze_characters(all_summaries: str, book_title: str) -> list:
    system = """Eres un experto en análisis literario. Analiza los personajes de una novela.
Responde ÚNICAMENTE con un array JSON válido, sin texto adicional ni bloques de código."""

    user = f"""Libro: "{book_title}"

Resúmenes de todos los capítulos:
{all_summaries[:20000]}

Identifica y analiza todos los personajes importantes. Devuelve un array JSON donde cada elemento tiene:
{{
  "name": "nombre completo",
  "aliases": ["apodo1"],
  "role": "protagonist|antagonist|secondary|minor",
  "description": "descripción física y contextual",
  "personality": "análisis de personalidad detallado",
  "arc": "evolución del personaje a lo largo del libro",
  "relationships": {{"nombre_personaje": "tipo de relación"}},
  "first_appearance": "nombre del capítulo donde aparece por primera vez",
  "quotes": ["cita memorable"]
}}"""

    result = await _call_ai(system, user, max_tokens=4000)
    try:
        data = _parse_json(result)
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ── Resumen global ────────────────────────────────────────────
async def generate_global_summary(all_summaries: str, book_title: str, author: Optional[str]) -> str:
    system = "Eres un crítico literario experto. Genera resúmenes globales exhaustivos en español."

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}

Resúmenes de capítulos:
{all_summaries[:25000]}

Escribe un resumen global completo (mínimo 500 palabras) que incluya:
- Trama principal completa con spoilers
- Arcos de los personajes principales
- Temas centrales de la obra
- Desenlace y conclusiones
- Valoración literaria breve

Escribe en prosa fluida, como una reseña académica detallada."""

    return await _call_ai(system, user, max_tokens=3000)


# ── Mapa mental ───────────────────────────────────────────────
async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = """Eres un experto en mapas mentales literarios.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código."""

    user = f"""Libro: "{book_title}"

Resúmenes: {all_summaries[:15000]}

Genera un mapa mental en JSON con esta estructura exacta:
{{
  "center": "{book_title}",
  "branches": [
    {{"label": "Trama principal", "color": "#6366f1", "children": ["evento clave 1", "evento clave 2"]}},
    {{"label": "Personajes", "color": "#f59e0b", "children": ["personaje: descripción breve"]}},
    {{"label": "Temas", "color": "#10b981", "children": ["tema 1", "tema 2"]}},
    {{"label": "Lugares", "color": "#ef4444", "children": ["lugar 1", "lugar 2"]}},
    {{"label": "Desenlace", "color": "#8b5cf6", "children": ["punto 1", "punto 2"]}}
  ]
}}"""

    result = await _call_ai(system, user, max_tokens=2000)
    try:
        return _parse_json(result)
    except Exception:
        return {"center": book_title, "branches": []}


# ── Guión del podcast ─────────────────────────────────────────
async def generate_podcast_script(
    book_title: str,
    author: Optional[str],
    global_summary: str,
    characters: list,
) -> str:
    system = """Eres un guionista de podcasts literarios en español.
Creas conversaciones naturales entre dos presentadores:
ANA (analítica, profunda) y CARLOS (entusiasta, empático).
Formato obligatorio: ANA: [texto] / CARLOS: [texto]"""

    chars_text = "\n".join(
        f"- {c['name']}: {c.get('personality', '')[:200]}"
        for c in characters[:8]
    ) if characters else "Sin información de personajes"

    user = f"""Podcast 8-12 min sobre "{book_title}" de {author or "autor desconocido"}.
Resumen: {global_summary[:5000]}
Personajes: {chars_text}
Cubre: introducción, sinopsis, trama con spoilers, personajes, temas, valoración, despedida."""

    return await _call_ai(system, user, max_tokens=4000)
