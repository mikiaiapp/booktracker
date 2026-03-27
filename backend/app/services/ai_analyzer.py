"""
AI analysis service supporting both Anthropic Claude and OpenAI GPT-4.
Model selected via AI_MODEL env var.
"""
import json
import re
from typing import Optional
from app.core.config import settings


def _is_claude() -> bool:
    return "claude" in settings.AI_MODEL.lower()


async def _call_ai(system: str, user: str, max_tokens: int = 2000) -> str:
    if _is_claude():
        return await _call_claude(system, user, max_tokens)
    else:
        return await _call_openai(system, user, max_tokens)


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
    """Safely parse JSON, stripping markdown fences."""
    clean = re.sub(r"```json|```", "", text).strip()
    return json.loads(clean)


# ── Chapter summary ───────────────────────────────────────────────────────────
async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: Optional[str]) -> dict:
    system = """Eres un experto literario que crea resúmenes detallados con spoilers completos.
El objetivo es que el lector pueda recordar exactamente qué pasó leyendo solo el resumen.
Responde ÚNICAMENTE con JSON válido, sin texto adicional."""

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}
Capítulo: "{chapter_title}"

Texto del capítulo:
{text[:15000]}

Genera un JSON con esta estructura exacta:
{{
  "summary": "Resumen detallado y extenso del capítulo con todos los eventos, diálogos importantes y spoilers (mínimo 300 palabras)",
  "key_events": ["evento 1", "evento 2", "evento 3", ...]
}}"""

    result = await _call_ai(system, user, max_tokens=2500)
    try:
        return _parse_json(result)
    except:
        return {"summary": result, "key_events": []}


# ── Character analysis ────────────────────────────────────────────────────────
async def analyze_characters(all_summaries: str, book_title: str) -> list:
    system = """Eres un experto en análisis literario. Analiza los personajes de una novela.
Responde ÚNICAMENTE con JSON válido, sin texto adicional."""

    user = f"""Libro: "{book_title}"

Resúmenes de todos los capítulos:
{all_summaries[:20000]}

Identifica y analiza todos los personajes importantes. Para cada uno genera:
{{
  "name": "nombre completo",
  "aliases": ["apodo1", "apodo2"],
  "role": "protagonist|antagonist|secondary|minor",
  "description": "descripción física y contextual",
  "personality": "análisis de personalidad detallado (200+ palabras)",
  "arc": "evolución y arco del personaje a lo largo del libro",
  "relationships": {{"nombre_personaje": "tipo de relación"}},
  "first_appearance": "nombre del capítulo donde aparece por primera vez",
  "quotes": ["cita memorable 1", "cita memorable 2"]
}}

Responde con un array JSON de personajes."""

    result = await _call_ai(system, user, max_tokens=4000)
    try:
        data = _parse_json(result)
        return data if isinstance(data, list) else []
    except:
        return []


# ── Global summary ────────────────────────────────────────────────────────────
async def generate_global_summary(all_summaries: str, book_title: str, author: Optional[str]) -> str:
    system = """Eres un crítico literario experto. Genera resúmenes globales exhaustivos."""

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}

Resúmenes de capítulos:
{all_summaries[:25000]}

Escribe un resumen global completo del libro (mínimo 500 palabras) que incluya:
- Trama principal completa con spoilers
- Arcos de los personajes principales
- Temas centrales de la obra
- Desenlace y conclusiones
- Valoración literaria breve

Escribe en prosa fluida, como si fuera una reseña académica detallada."""

    return await _call_ai(system, user, max_tokens=3000)


# ── Mind map ──────────────────────────────────────────────────────────────────
async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = """Eres un experto en mapas mentales literarios.
Responde ÚNICAMENTE con JSON válido, sin texto adicional."""

    user = f"""Libro: "{book_title}"

Resúmenes: {all_summaries[:15000]}

Genera un mapa mental del libro en formato JSON:
{{
  "center": "{book_title}",
  "branches": [
    {{
      "label": "Trama principal",
      "color": "#6366f1",
      "children": ["evento clave 1", "evento clave 2", ...]
    }},
    {{
      "label": "Personajes",
      "color": "#f59e0b",
      "children": ["personaje1: descripción breve", ...]
    }},
    {{
      "label": "Temas",
      "color": "#10b981",
      "children": ["tema 1", "tema 2", ...]
    }},
    {{
      "label": "Lugares",
      "color": "#ef4444",
      "children": ["lugar 1", "lugar 2", ...]
    }},
    {{
      "label": "Desenlace",
      "color": "#8b5cf6",
      "children": ["punto 1", "punto 2", ...]
    }}
  ]
}}"""

    result = await _call_ai(system, user, max_tokens=2000)
    try:
        return _parse_json(result)
    except:
        return {"center": book_title, "branches": []}


# ── Podcast script ────────────────────────────────────────────────────────────
async def generate_podcast_script(
    book_title: str,
    author: Optional[str],
    global_summary: str,
    characters: list,
) -> str:
    system = """Eres un guionista de podcasts literarios. Creas conversaciones naturales y entretenidas entre dos presentadores: 
ANA (analítica, profunda, le gustan los temas filosóficos) y CARLOS (entusiasta, empático, se centra en los personajes y emociones).
El podcast debe sonar natural, con interrupciones, acuerdos, debates y humor ocasional."""

    chars_text = "\n".join(
        f"- {c['name']}: {c.get('personality', '')[:200]}" for c in characters[:8]
    ) if characters else "Sin información de personajes"

    user = f"""Crea el guión completo de un podcast de 8-12 minutos sobre el libro "{book_title}" de {author or "autor desconocido"}.

RESUMEN DEL LIBRO:
{global_summary[:5000]}

PERSONAJES PRINCIPALES:
{chars_text}

Formato del guión (usa exactamente este formato para cada línea):
ANA: [diálogo]
CARLOS: [diálogo]

El podcast debe cubrir:
1. Introducción y bienvenida
2. Sinopsis sin spoilers (para enganchar)
3. Análisis de la trama (con spoilers, avisando)
4. Discusión de personajes principales y su evolución
5. Temas y simbolismo
6. Valoración final y recomendación
7. Despedida

Escribe el guión completo ahora:"""

    return await _call_ai(system, user, max_tokens=4000)
