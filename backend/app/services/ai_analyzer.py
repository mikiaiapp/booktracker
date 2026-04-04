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
    from openai import AsyncOpenAI, RateLimitError
    import asyncio as _asyncio
    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    max_retries = 4
    for attempt in range(max_retries):
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
        except RateLimitError as e:
            if attempt < max_retries - 1:
                wait = 20 * (attempt + 1)  # 20s, 40s, 60s
                print(f"OpenAI 429 — esperando {wait}s antes de reintentar ({attempt+1}/{max_retries})")
                await _asyncio.sleep(wait)
                continue
            # Calcular tiempo hasta reset (OpenAI resetea por minuto, no por día)
            raise ValueError(f"OpenAI rate limit alcanzado. Espera 1 minuto e inténtalo de nuevo.")
        except Exception as e:
            raise


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
    """
    Parsea JSON de la respuesta IA con máxima tolerancia:
    1. Elimina markdown
    2. Parseo directo — si devuelve dict, intenta desenvolver
    3. Repara array truncado desde el primer [ encontrado
    4. Extrae primer array [] completo con regex
    5. Extrae primer objeto {} y desenvuelve si tiene clave de lista
    """
    if not text:
        raise ValueError("Respuesta vacía")

    WRAP_KEYS = ("characters", "personajes", "items", "data", "results", "list",
                 "personages", "characters_list")

    def _unwrap(obj):
        """Si es dict que envuelve una lista, devuelve la lista."""
        if isinstance(obj, list):
            return obj
        if isinstance(obj, dict):
            for key in WRAP_KEYS:
                if key in obj and isinstance(obj[key], list):
                    return obj[key]
        return obj

    # 1. Eliminar bloques markdown y whitespace
    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()

    # 2. Parseo directo — cubre el caso feliz y el de dict envolvente
    try:
        result = json.loads(clean)
        return _unwrap(result)
    except json.JSONDecodeError:
        pass

    # 3. Reparar array truncado desde el primer [ del texto
    #    (antes que los regex, porque el regex de {} encontraría el primer objeto)
    bracket = clean.find("[")
    if bracket != -1:
        repaired = _repair_truncated_array(clean[bracket:])
        if repaired:
            return repaired

    # 4. Buscar y parsear el primer array [] completo con regex
    arr_match = re.search(r'\[[\s\S]*\]', clean)
    if arr_match:
        try:
            result = json.loads(arr_match.group())
            return _unwrap(result)
        except json.JSONDecodeError:
            pass

    # 5. Buscar y parsear el primer objeto {} completo con regex
    obj_match = re.search(r'\{[\s\S]*\}', clean)
    if obj_match:
        try:
            result = json.loads(obj_match.group())
            return _unwrap(result)
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No se pudo parsear JSON: {clean[:300]}")


def _repair_truncated_array(fragment: str) -> list | None:
    """
    Recupera los objetos {} completos de un array JSON truncado.
    Útil cuando la respuesta se corta por límite de tokens.
    """
    objects = []
    depth = 0
    in_string = False
    escape_next = False
    current_start = None
    i = 0

    while i < len(fragment):
        ch = fragment[i]

        if escape_next:
            escape_next = False
            i += 1
            continue

        if ch == '\\' and in_string:
            escape_next = True
            i += 1
            continue

        if ch == '"':
            in_string = not in_string
            i += 1
            continue

        if in_string:
            i += 1
            continue

        if ch == '{':
            if depth == 0:
                current_start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and current_start is not None:
                candidate = fragment[current_start:i + 1]
                try:
                    obj = json.loads(candidate)
                    if isinstance(obj, dict) and obj:
                        objects.append(obj)
                except json.JSONDecodeError:
                    pass
                current_start = None
        i += 1

    if objects:
        print(f"_repair_truncated_array: recuperados {len(objects)} objetos")
        return objects
    return None


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
    """
    Análisis en dos pasadas independientes (4000 tokens cada una) para evitar
    truncado. La primera cubre protagonistas/antagonistas con detalle,
    la segunda los secundarios y menores de forma concisa.
    """
    import asyncio as _asyncio

    system = (
        "Eres un experto en análisis literario. "
        "Responde SIEMPRE con un array JSON válido y nada más. "
        "Sin texto previo, sin explicaciones, sin bloques markdown."
    )

    # Limitar contexto a ~15 000 chars para dejar espacio a la respuesta
    ctx = all_summaries[:15000]

    schema = """{
  "name": "nombre completo del personaje",
  "aliases": ["apodo o nombre alternativo"],
  "role": "protagonist | antagonist | secondary | minor",
  "description": "descripción física, edad aproximada, origen y contexto social",
  "personality": "rasgos dominantes, virtudes, defectos, motivaciones y miedos",
  "arc": "evolución: punto de partida, conflictos, cambios y estado final",
  "key_moments": ["momento clave 1", "momento clave 2"],
  "relationships": {"otro_personaje": "tipo y evolución de la relación"},
  "first_appearance": "capítulo de primera aparición",
  "importance": "función concreta en la trama",
  "quotes": ["frase o momento definitorio"]
}"""

    prompt_main = f"""Libro: "{book_title}"

Resúmenes de capítulos:
{ctx}

TAREA: Devuelve un array JSON con los personajes protagonistas y antagonistas (máximo 5).
Análisis detallado para cada uno (mínimo 3 frases por campo).

Formato de cada elemento:
{schema}

IMPORTANTE: Empieza directamente con [ sin ningún texto previo."""

    prompt_secondary = f"""Libro: "{book_title}"

Resúmenes de capítulos:
{ctx}

TAREA: Devuelve un array JSON con TODOS los personajes secundarios y menores
(excluye protagonistas y antagonistas principales).
Incluye cualquier personaje con nombre propio o función en la trama.
Análisis conciso para cada uno (1-2 frases por campo).

Formato de cada elemento:
{schema}

IMPORTANTE: Empieza directamente con [ sin ningún texto previo."""

    # Pasada 1 — protagonistas/antagonistas
    print(f"[characters] Pasada 1 — protagonistas de '{book_title}'")
    try:
        raw1 = await _call_ai(system, prompt_main, max_tokens=4000)
        print(f"[characters] Pasada 1 raw: {len(raw1)} chars — primeros 120: {raw1[:120]!r}")
        parsed1 = _parse_json(raw1)
        chars_main = parsed1 if isinstance(parsed1, list) else []
        print(f"[characters] Pasada 1 → {len(chars_main)} personajes")
    except Exception as e:
        chars_main = []
        print(f"[characters] ERROR pasada 1: {e}")

    await _asyncio.sleep(4)

    # Pasada 2 — secundarios/menores
    print(f"[characters] Pasada 2 — secundarios de '{book_title}'")
    try:
        raw2 = await _call_ai(system, prompt_secondary, max_tokens=4000)
        print(f"[characters] Pasada 2 raw: {len(raw2)} chars — primeros 120: {raw2[:120]!r}")
        parsed2 = _parse_json(raw2)
        chars_secondary = parsed2 if isinstance(parsed2, list) else []
        print(f"[characters] Pasada 2 → {len(chars_secondary)} personajes")
    except Exception as e:
        chars_secondary = []
        print(f"[characters] ERROR pasada 2: {e}")

    # Deduplicar por nombre normalizado
    def _norm(n: str) -> str:
        return re.sub(r"\s+", "", n.lower().strip()) if n else ""

    seen = {_norm(c.get("name", "")) for c in chars_main if c.get("name")}
    combined = list(chars_main)

    for char in chars_secondary:
        n = _norm(char.get("name", ""))
        if n and n not in seen:
            seen.add(n)
            combined.append(char)

    print(f"[characters] Total combinado: {len(combined)} personajes")
    if not combined:
        print(f"[characters] ADVERTENCIA: cero personajes. Raw1={raw1[:200]!r} Raw2={raw2[:200]!r}")

    return combined

# ── Resumen global ────────────────────────────────────────────
async def generate_global_summary(all_summaries: str, book_title: str, author: Optional[str]) -> str:
    system = "Eres un crítico literario experto. Genera resúmenes globales exhaustivos en español."

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}

Resúmenes de capítulos:
{all_summaries[:30000]}

Escribe un resumen global exhaustivo (mínimo 800 palabras) que incluya:
- Contexto y presentación del mundo narrativo
- Trama principal completa con todos los giros y spoilers
- Subtramas importantes
- Arcos de evolución de los personajes principales
- Temas centrales, simbolismo y mensaje del autor
- Desenlace detallado y conclusiones
- Estilo narrativo y recursos literarios destacables
- Valoración crítica con puntos fuertes y débiles

Escribe en prosa fluida y rica, como una reseña académica detallada para un club de lectura."""

    return await _call_ai(system, user, max_tokens=4000)


# ── Mapa mental ───────────────────────────────────────────────
async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = """Eres un experto en mapas mentales literarios.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni bloques de código."""

    user = f"""Libro: "{book_title}"

Resúmenes completos: {all_summaries[:25000]}

Genera un mapa mental MUY DETALLADO en JSON con contenido 100% específico de este libro, sin frases genéricas.
Cada rama debe tener 6-10 hijos concretos con nombres, eventos y detalles reales del libro.

Estructura exacta (8 ramas obligatorias):
{{
  "center": "{book_title}",
  "branches": [
    {{
      "label": "Trama principal",
      "color": "#6366f1",
      "children": [
        "Acto 1: [describe el arranque concreto con personajes y situación]",
        "Detonante: [evento específico que cambia todo]",
        "Nudo: [conflicto central desarrollado]",
        "Giro 1: [primer giro importante]",
        "Giro 2: [segundo giro si existe]",
        "Clímax: [momento de máxima tensión, específico]",
        "Desenlace: [resolución concreta]"
      ]
    }},
    {{
      "label": "Subtramas",
      "color": "#06b6d4",
      "children": ["[nombre personaje]: [conflicto/arco específico de la subtrama]", "...mínimo 4 subtramas"]
    }},
    {{
      "label": "Personajes clave",
      "color": "#f59e0b",
      "children": ["[Nombre]: [rol] — [rasgo definitorio y arco en una frase]", "...todos los personajes importantes"]
    }},
    {{
      "label": "Relaciones entre personajes",
      "color": "#f97316",
      "children": ["[Personaje A] ↔ [Personaje B]: [tipo de relación y cómo evoluciona]", "...mínimo 5 relaciones"]
    }},
    {{
      "label": "Temas y mensajes",
      "color": "#10b981",
      "children": ["[Tema]: cómo se manifiesta concretamente en el libro", "...mínimo 5 temas"]
    }},
    {{
      "label": "Escenarios y época",
      "color": "#ef4444",
      "children": ["[Lugar]: su función dramática en la historia", "Época: [contexto histórico y su impacto]", "...todos los escenarios relevantes"]
    }},
    {{
      "label": "Símbolos y leitmotivs",
      "color": "#ec4899",
      "children": ["[Símbolo]: [su significado específico en este libro]", "...mínimo 5 símbolos o motivos recurrentes"]
    }},
    {{
      "label": "Estilo y técnica narrativa",
      "color": "#8b5cf6",
      "children": [
        "Narrador: [tipo y efecto]",
        "Tiempo narrativo: [lineal, flashbacks, etc.]",
        "Recursos: [metáforas, ironía, suspense... con ejemplos]",
        "Ritmo: [descripción del ritmo narrativo]",
        "Punto de vista: [perspectiva y su impacto]"
      ]
    }}
  ]
}}"""

    result = await _call_ai(system, user, max_tokens=4000)
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
        f"- {c['name']} ({c.get('role','')}: {c.get('personality', '')[:300]}"
        for c in characters[:12]
    ) if characters else "Sin información de personajes"

    user = f"""Crea un podcast completo de 15-20 minutos sobre "{book_title}" de {author or "autor desconocido"}.

Resumen global: {global_summary[:8000]}
Personajes principales: {chars_text}

Estructura del podcast (cada sección debe ser sustancial):
1. INTRODUCCIÓN — presentación del libro, autor y contexto histórico/literario
2. PRIMERA IMPRESIÓN — qué tipo de libro es, a quién va dirigido
3. TRAMA — narración detallada del argumento con todos los giros importantes (con spoilers)
4. PERSONAJES — análisis profundo de los 3-4 personajes más importantes
5. TEMAS — temas centrales, simbolismo, mensaje del autor
6. PUNTOS FUERTES Y DÉBILES — crítica literaria honesta
7. COMPARATIVA — similitudes con otras obras del género
8. VALORACIÓN FINAL — nota y recomendación
9. DESPEDIDA

Recuerda: ANA es analítica y busca el significado profundo. CARLOS es más emocional y conecta con el lector común. Que el diálogo sea natural, con interrupciones y acuerdos."""

    return await _call_ai(system, user, max_tokens=6000)
