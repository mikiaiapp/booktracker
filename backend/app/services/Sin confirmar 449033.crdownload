"""
AI analysis service.
Soporta tres proveedores configurables via AI_MODEL:
  - gemini-2.0-flash        → Google Gemini (gratuito, 1500 req/día)
  - claude-sonnet-4-*       → Anthropic Claude
  - gpt-4o / gpt-4o-mini    → OpenAI
"""
import json
import re
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
    import google.generativeai as genai
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(
        model_name=settings.AI_MODEL,
        system_instruction=system,
        generation_config={"max_output_tokens": max_tokens, "temperature": 0.3},
    )
    # Gemini es síncrono — lo ejecutamos en un executor para no bloquear
    import asyncio
    loop = asyncio.get_event_loop()
    response = await loop.run_in_executor(
        None, lambda: model.generate_content(user)
    )
    return response.text


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


def _parse_json(text: str) -> dict | list:
    clean = re.sub(r"```json|```", "", text).strip()
    return json.loads(clean)


# ── Resumen de capítulo ───────────────────────────────────────
async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: Optional[str]) -> dict:
    system = """Eres un experto literario que crea resúmenes detallados con spoilers completos.
El objetivo es que el lector pueda recordar exactamente qué pasó leyendo solo el resumen.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código."""

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}
Capítulo: "{chapter_title}"

Texto del capítulo:
{text[:15000]}

Genera un JSON con esta estructura exacta:
{{
  "summary": "Resumen detallado del capítulo con todos los eventos importantes y spoilers (mínimo 300 palabras)",
  "key_events": ["evento 1", "evento 2", "evento 3"]
}}"""

    result = await _call_ai(system, user, max_tokens=2500)
    try:
        return _parse_json(result)
    except Exception:
        return {"summary": result, "key_events": []}


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
    {{
      "label": "Trama principal",
      "color": "#6366f1",
      "children": ["evento clave 1", "evento clave 2"]
    }},
    {{
      "label": "Personajes",
      "color": "#f59e0b",
      "children": ["personaje: descripción breve"]
    }},
    {{
      "label": "Temas",
      "color": "#10b981",
      "children": ["tema 1", "tema 2"]
    }},
    {{
      "label": "Lugares",
      "color": "#ef4444",
      "children": ["lugar 1", "lugar 2"]
    }},
    {{
      "label": "Desenlace",
      "color": "#8b5cf6",
      "children": ["punto 1", "punto 2"]
    }}
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
Creas conversaciones naturales y entretenidas entre dos presentadores:
ANA (analítica, profunda, le gustan los temas filosóficos) y
CARLOS (entusiasta, empático, se centra en personajes y emociones).
El podcast debe sonar natural, con interrupciones, acuerdos y debates."""

    chars_text = "\n".join(
        f"- {c['name']}: {c.get('personality', '')[:200]}"
        for c in characters[:8]
    ) if characters else "Sin información de personajes"

    user = f"""Crea el guión completo de un podcast de 8-12 minutos sobre "{book_title}" de {author or "autor desconocido"}.

RESUMEN DEL LIBRO:
{global_summary[:5000]}

PERSONAJES PRINCIPALES:
{chars_text}

Formato obligatorio para cada línea de diálogo:
ANA: [diálogo]
CARLOS: [diálogo]

El podcast debe cubrir:
1. Introducción y bienvenida
2. Sinopsis sin spoilers
3. Análisis de la trama con spoilers (avisando)
4. Discusión de personajes y su evolución
5. Temas y simbolismo
6. Valoración final y recomendación
7. Despedida"""

    return await _call_ai(system, user, max_tokens=4000)
