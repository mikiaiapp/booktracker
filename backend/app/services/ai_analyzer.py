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
    """Parsea JSON de la respuesta IA, intentando reparar arrays truncados."""
    if not text:
        raise ValueError("Respuesta vacía")
    # Eliminar bloques markdown
    clean = re.sub(r"```json\s*|```\s*", "", text).strip()
    # Intentar parsear directamente
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        pass
    # Intentar extraer el primer objeto o array JSON del texto
    for pattern in [r'\[[\s\S]*\]', r'\{[\s\S]*\}']:
        match = re.search(pattern, clean)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass

    # ── Reparar array JSON truncado (respuesta cortada por límite de tokens) ──
    # Buscar el inicio del array
    start = clean.find('[')
    if start != -1:
        fragment = clean[start:]
        # Estrategia 1: cerrar el último objeto incompleto y el array
        repaired = _repair_truncated_array(fragment)
        if repaired:
            return repaired

    raise ValueError(f"No se pudo parsear JSON: {clean[:300]}")


def _repair_truncated_array(fragment: str) -> list | None:
    """
    Intenta recuperar los objetos completos de un array JSON truncado.
    Extrae elemento a elemento hasta donde el JSON es válido.
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
                # Tenemos un objeto completo — intentar parsearlo
                candidate = fragment[current_start:i+1]
                try:
                    obj = json.loads(candidate)
                    if isinstance(obj, dict) and obj:
                        objects.append(obj)
                except json.JSONDecodeError:
                    pass
                current_start = None
        i += 1

    if objects:
        print(f"JSON reparado: recuperados {len(objects)} objetos de un array truncado")
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
    Análisis de personajes en dos pasadas para evitar truncado por límite de tokens:
    Pasada 1 → protagonistas y antagonistas (análisis exhaustivo, ~6 personajes)
    Pasada 2 → personajes secundarios y menores (análisis conciso, hasta 20)
    Se combinan y deduplicanen en la lista final.
    """
    system = """Eres un experto en análisis literario. Analiza los personajes de una novela.
Responde ÚNICAMENTE con un array JSON válido, sin texto adicional ni bloques de código markdown."""

    summaries_short = all_summaries[:20000]  # contexto razonable para no saturar

    # ── Pasada 1: protagonistas y antagonistas ─────────────────
    user_main = f"""Libro: "{book_title}"

Resúmenes:
{summaries_short}

Analiza ÚNICAMENTE los personajes con rol "protagonist" o "antagonist" (máximo 6).
Para cada uno, análisis EXHAUSTIVO con al menos 4 frases en cada campo de texto.

Devuelve un array JSON. Cada elemento:
{{
  "name": "nombre completo",
  "aliases": ["apodo1"],
  "role": "protagonist|antagonist",
  "description": "descripción física detallada, edad aproximada, origen social",
  "personality": "rasgos dominantes, virtudes, defectos, motivaciones, miedos, contradicciones",
  "arc": "evolución a lo largo del libro: punto de partida, conflictos clave, cambios, desenlace",
  "key_moments": ["momento crucial 1", "momento crucial 2", "momento crucial 3"],
  "relationships": {{"otro_personaje": "naturaleza y evolución de la relación"}},
  "first_appearance": "capítulo de primera aparición",
  "importance": "función concreta en la trama",
  "quotes": ["frase o momento definitorio del personaje"]
}}"""

    # ── Pasada 2: secundarios y menores ───────────────────────
    user_secondary = f"""Libro: "{book_title}"

Resúmenes:
{summaries_short}

Identifica TODOS los personajes secundarios y menores (rol "secondary" o "minor").
No incluyas protagonistas ni antagonistas principales.
Incluye cualquier personaje con nombre propio o función reconocible en la trama.

Para cada uno, análisis conciso pero completo (2-3 frases por campo de texto).

Devuelve un array JSON. Cada elemento:
{{
  "name": "nombre completo",
  "aliases": [],
  "role": "secondary|minor",
  "description": "descripción breve",
  "personality": "rasgos principales y motivaciones",
  "arc": "función y evolución en la trama",
  "key_moments": ["momento relevante"],
  "relationships": {{"otro_personaje": "tipo de relación"}},
  "first_appearance": "capítulo aproximado",
  "importance": "qué aporta a la historia",
  "quotes": []
}}"""

    import asyncio as _asyncio

    # Ejecutar las dos pasadas — primero protagonistas, luego secundarios
    print(f"analyze_characters: pasada 1 (protagonistas) para '{book_title}'")
    result_main = await _call_ai(system, user_main, max_tokens=4000)
    print(f"analyze_characters: pasada 1 → {len(result_main)} chars")

    # Pausa entre llamadas para no saturar la API
    await _asyncio.sleep(3)

    print(f"analyze_characters: pasada 2 (secundarios) para '{book_title}'")
    result_secondary = await _call_ai(system, user_secondary, max_tokens=4000)
    print(f"analyze_characters: pasada 2 → {len(result_secondary)} chars")

    # Parsear ambas respuestas
    chars_main = []
    chars_secondary = []

    try:
        data = _parse_json(result_main)
        chars_main = data if isinstance(data, list) else []
        print(f"analyze_characters: pasada 1 → {len(chars_main)} personajes")
    except Exception as e:
        print(f"analyze_characters: error parseando pasada 1: {e}\nRaw: {result_main[:300]}")

    try:
        data = _parse_json(result_secondary)
        chars_secondary = data if isinstance(data, list) else []
        print(f"analyze_characters: pasada 2 → {len(chars_secondary)} personajes")
    except Exception as e:
        print(f"analyze_characters: error parseando pasada 2: {e}\nRaw: {result_secondary[:300]}")

    # Combinar y deduplicar por nombre (normalizado)
    def _norm_name(n: str) -> str:
        return re.sub(r"[^a-záéíóúüñ]", "", n.lower().strip()) if n else ""

    seen_names = {_norm_name(c.get("name", "")) for c in chars_main if c.get("name")}
    combined = list(chars_main)

    for char in chars_secondary:
        name_norm = _norm_name(char.get("name", ""))
        if name_norm and name_norm not in seen_names:
            seen_names.add(name_norm)
            combined.append(char)

    print(f"analyze_characters: total combinado → {len(combined)} personajes")

    if not combined:
        print(f"analyze_characters: ADVERTENCIA — ninguna pasada devolvió personajes")

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
