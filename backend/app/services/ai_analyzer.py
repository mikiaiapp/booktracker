"""
AI analysis service.
Proveedores soportados via AI_MODEL:
  - gemini-2.0-flash  -> Google Gemini via API REST
  - claude-*          -> Anthropic Claude
  - gpt-4o / gpt-*    -> OpenAI
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
    api_key = (
        settings.GEMINI_API_KEY
        or os.environ.get("GEMINI_API_KEY")
        or os.environ.get("GOOGLE_API_KEY")
    )
    if not api_key:
        raise ValueError("Configura GEMINI_API_KEY en las variables de entorno de Portainer")

    url = f"https://generativelanguage.googleapis.com/v1/models/{settings.AI_MODEL}:generateContent?key={api_key}"
    combined = f"{system}\n\n{user}"
    payload = {
        "contents": [{"parts": [{"text": combined}]}],
        "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3},
    }

    import asyncio
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
                        r.json()["error"]["details"][-1].get("retryDelay", "60s").replace("s", "")
                    )
                except Exception:
                    retry_secs = 60
                wait = min(retry_secs + (attempt * 15), 120)
                await asyncio.sleep(wait)
                continue
            from datetime import datetime, timezone, timedelta
            now = datetime.now(timezone.utc)
            reset = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            hours_left = int((reset - now).total_seconds() // 3600)
            mins_left  = int(((reset - now).total_seconds() % 3600) // 60)
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
                wait = 20 * (attempt + 1)
                await _asyncio.sleep(wait)
                continue
            raise ValueError("OpenAI rate limit alcanzado. Espera 1 minuto e intentalo de nuevo.")
        except Exception:
            raise


def _clean_summary(text: str) -> str:
    if not text:
        return text
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = re.sub(r'\\"([^"]+)\\"', r'"\1"', text)
    text = re.sub(r'\\"', '"', text)
    text = text.replace("\\n\\n", "\n\n")
    text = text.replace("\\n", "\n")
    text = re.sub(r'^\{\s*"summary"\s*:\s*"?', "", text)
    text = re.sub(r'"?\s*,?\s*"key_events".*$', "", text, flags=re.DOTALL)
    text = re.sub(r"  +", " ", text)
    return text.strip().strip('"')


def _clean_text(text: str) -> str:
    text = re.sub(r"```json\s*", "", text)
    text = re.sub(r"```\s*", "", text)
    text = text.replace('\\"', '"')
    text = re.sub(r"\n\n+", "\n\n", text)
    text = re.sub(r"\n", " ", text)
    return text.strip()


def _parse_json(text: str) -> dict | list:
    """
    Parsea JSON con maxima tolerancia:
    1. Limpia markdown y parsea directo
    2. Repara array truncado
    3. Extrae primer array [] con regex
    4. Extrae primer objeto {} y desenvuelve
    """
    if not text:
        raise ValueError("Respuesta vacia")

    WRAP_KEYS = ("characters", "personajes", "items", "data", "results", "list",
                 "personages", "characters_list")

    def _unwrap(obj):
        if isinstance(obj, list):
            return obj
        if isinstance(obj, dict):
            for key in WRAP_KEYS:
                if key in obj and isinstance(obj[key], list):
                    return obj[key]
        return obj

    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()

    try:
        result = json.loads(clean)
        return _unwrap(result)
    except json.JSONDecodeError:
        pass

    bracket = clean.find("[")
    if bracket != -1:
        repaired = _repair_truncated_array(clean[bracket:])
        if repaired:
            return repaired

    arr_match = re.search(r'\[[\s\S]*\]', clean)
    if arr_match:
        try:
            result = json.loads(arr_match.group())
            return _unwrap(result)
        except json.JSONDecodeError:
            pass

    obj_match = re.search(r'\{[\s\S]*\}', clean)
    if obj_match:
        try:
            result = json.loads(obj_match.group())
            return _unwrap(result)
        except json.JSONDecodeError:
            pass

    raise ValueError(f"No se pudo parsear JSON: {clean[:300]}")


def _repair_truncated_array(fragment: str) -> list | None:
    """Recupera objetos {} completos de un array JSON truncado."""
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


# ── Resumen de capitulo ───────────────────────────────────────────────────────

async def summarize_chapter(chapter_title: str, text: str, book_title: str, author: Optional[str]) -> dict:
    system = """Eres un experto literario que crea resumenes detallados con spoilers completos.
Responde UNICAMENTE con JSON valido, sin texto adicional ni bloques de codigo."""

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}
Capitulo: "{chapter_title}"

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


# ── Analisis de personajes ────────────────────────────────────────────────────

async def analyze_characters(all_summaries: str, book_title: str, on_progress=None) -> list:
    """
    Analisis en dos pasadas para cubrir todos los personajes sin truncar:
      Pasada 1: protagonistas y antagonistas — analisis detallado
      Pasada 2: personajes secundarios y menores — analisis conciso
    Cada pasada usa 6000 tokens para acomodar listas amplias.
    on_progress: callable(msg: str) opcional para actualizar progreso entre pasadas.
    """
    import asyncio as _asyncio

    system = (
        "Eres un experto en analisis literario. "
        "Responde SIEMPRE con un array JSON valido y nada mas. "
        "Sin texto previo, sin explicaciones, sin bloques markdown. "
        "Empieza directamente con el caracter [ ."
    )

    # Contexto limitado a ~15000 chars para dejar espacio a la respuesta
    ctx = all_summaries[:15000]

    # Schema completo con todos los campos del modelo
    schema = """{
  "name": "nombre completo del personaje",
  "aliases": ["apodo o nombre alternativo si lo tiene"],
  "role": "protagonist | antagonist | secondary | minor",
  "description": "descripcion fisica detallada: edad aproximada, aspecto, origen, clase social y contexto",
  "personality": "rasgos de caracter dominantes, virtudes, defectos, motivaciones profundas y miedos",
  "arc": "evolucion completa: estado inicial, conflictos que enfrenta, cambios sufridos y estado final",
  "key_moments": ["momento clave 1 con contexto", "momento clave 2 con contexto"],
  "relationships": {"nombre_otro_personaje": "tipo de relacion y como evoluciona a lo largo de la obra"},
  "first_appearance": "titulo del capitulo o escena de primera aparicion",
  "quotes": ["frase o accion representativa del personaje"]
}"""

    # ── Pasada 1: protagonistas y antagonistas ──
    prompt_main = f"""Libro: "{book_title}"

Resumenes de capitulos:
{ctx}

TAREA: Devuelve un array JSON con TODOS los personajes protagonistas y antagonistas del libro.
Incluye todos los que tienen un papel central en la trama, sin limite artificioso de cantidad.
Cada personaje debe tener un analisis detallado con al menos 2-3 frases por campo.

Formato de cada elemento del array:
{schema}

IMPORTANTE: Empieza directamente con [ sin ningun texto previo."""

    # ── Pasada 2: secundarios y menores ──
    prompt_secondary = f"""Libro: "{book_title}"

Resumenes de capitulos:
{ctx}

TAREA: Devuelve un array JSON con los personajes secundarios y menores de la obra.
Excluye protagonistas y antagonistas principales (ya analizados por separado).
Incluye cualquier personaje con nombre propio o funcion relevante en la trama.
Analisis conciso pero completo: 1-2 frases por campo.

Formato de cada elemento del array:
{schema}

IMPORTANTE: Empieza directamente con [ sin ningun texto previo."""

    # ── Ambas pasadas en PARALELO ─────────────────────────────────────────────
    print(f"[characters] Lanzando pasadas 1+2 en paralelo para '{book_title}'")

    results = await _asyncio.gather(
        _call_ai(system, prompt_main, max_tokens=6000),
        _call_ai(system, prompt_secondary, max_tokens=6000),
        return_exceptions=True
    )
    raw1 = results[0] if not isinstance(results[0], Exception) else ""
    raw2 = results[1] if not isinstance(results[1], Exception) else ""
    if isinstance(results[0], Exception):
        print(f"[characters] ERROR pasada 1: {results[0]}")
    else:
        print(f"[characters] Pasada 1 raw: {len(raw1)} chars — primeros 150: {raw1[:150]!r}")
    if isinstance(results[1], Exception):
        print(f"[characters] ERROR pasada 2: {results[1]}")
    else:
        print(f"[characters] Pasada 2 raw: {len(raw2)} chars — primeros 150: {raw2[:150]!r}")

    # Parsear pasada 1
    chars_main = []
    if raw1:
        try:
            parsed1    = _parse_json(raw1)
            chars_main = [c for c in (parsed1 if isinstance(parsed1, list) else [])
                          if isinstance(c, dict) and c.get("name")]
            print(f"[characters] Pasada 1 => {len(chars_main)} personajes principales")
        except Exception as e:
            print(f"[characters] ERROR parsando pasada 1: {e}")

    # Parsear pasada 2
    chars_secondary = []
    if raw2:
        try:
            parsed2         = _parse_json(raw2)
            chars_secondary = [c for c in (parsed2 if isinstance(parsed2, list) else [])
                               if isinstance(c, dict) and c.get("name")]
            print(f"[characters] Pasada 2 => {len(chars_secondary)} personajes secundarios")
        except Exception as e:
            print(f"[characters] ERROR parsando pasada 2: {e}")

    # Deduplicar por nombre normalizado
    def _norm(n: str) -> str:
        return re.sub(r"\s+", "", n.lower().strip()) if n else ""

    seen    = {_norm(c.get("name", "")) for c in chars_main if c.get("name")}
    combined = list(chars_main)

    for char in chars_secondary:
        n = _norm(char.get("name", ""))
        if n and n not in seen:
            seen.add(n)
            combined.append(char)

    print(f"[characters] Total combinado: {len(combined)} personajes")
    if not combined:
        print(f"[characters] ADVERTENCIA: cero personajes obtenidos.")

    return combined


# ── Resumen global ────────────────────────────────────────────────────────────

async def generate_global_summary(all_summaries: str, book_title: str, author: Optional[str]) -> str:
    system = "Eres un critico literario experto. Genera resumenes globales exhaustivos en espanol."

    user = f"""Libro: "{book_title}" de {author or "autor desconocido"}

Resumenes de capitulos:
{all_summaries[:30000]}

Escribe un resumen global exhaustivo (minimo 800 palabras) que incluya:
- Contexto y presentacion del mundo narrativo
- Trama principal completa con todos los giros y spoilers
- Subtramas importantes
- Arcos de evolucion de los personajes principales
- Temas centrales, simbolismo y mensaje del autor
- Desenlace detallado y conclusiones
- Estilo narrativo y recursos literarios destacables
- Valoracion critica con puntos fuertes y debiles

Escribe en prosa fluida y rica, como una resena academica detallada para un club de lectura."""

    return await _call_ai(system, user, max_tokens=4000)


# ── Mapa mental ───────────────────────────────────────────────────────────────

async def generate_mindmap(all_summaries: str, book_title: str) -> dict:
    system = """Eres un experto en mapas mentales literarios.
Responde UNICAMENTE con JSON valido, sin texto adicional ni bloques de codigo."""

    user = f"""Libro: "{book_title}"

Resumenes completos: {all_summaries[:25000]}

Genera un mapa mental MUY DETALLADO en JSON con contenido 100% especifico de este libro, sin frases genericas.
Cada rama debe tener 6-10 hijos concretos con nombres, eventos y detalles reales del libro.

Estructura exacta (8 ramas obligatorias):
{{
  "center": "{book_title}",
  "branches": [
    {{
      "label": "Trama principal",
      "color": "#6366f1",
      "children": [
        "Acto 1: [describe el arranque concreto con personajes y situacion]",
        "Detonante: [evento especifico que cambia todo]",
        "Nudo: [conflicto central desarrollado]",
        "Giro 1: [primer giro importante]",
        "Giro 2: [segundo giro si existe]",
        "Climax: [momento de maxima tension, especifico]",
        "Desenlace: [resolucion concreta]"
      ]
    }},
    {{
      "label": "Subtramas",
      "color": "#06b6d4",
      "children": ["[nombre personaje]: [conflicto/arco especifico de la subtrama]", "...minimo 4 subtramas"]
    }},
    {{
      "label": "Personajes clave",
      "color": "#f59e0b",
      "children": ["[Nombre]: [rol] - [rasgo definitorio y arco en una frase]", "...todos los personajes importantes"]
    }},
    {{
      "label": "Relaciones entre personajes",
      "color": "#f97316",
      "children": ["[Personaje A] <-> [Personaje B]: [tipo de relacion y como evoluciona]", "...minimo 5 relaciones"]
    }},
    {{
      "label": "Temas y mensajes",
      "color": "#10b981",
      "children": ["[Tema]: como se manifiesta concretamente en el libro", "...minimo 5 temas"]
    }},
    {{
      "label": "Escenarios y epoca",
      "color": "#ef4444",
      "children": ["[Lugar]: su funcion dramatica en la historia", "Epoca: [contexto historico y su impacto]", "...todos los escenarios relevantes"]
    }},
    {{
      "label": "Simbolos y leitmotivs",
      "color": "#ec4899",
      "children": ["[Simbolo]: [su significado especifico en este libro]", "...minimo 5 simbolos o motivos recurrentes"]
    }},
    {{
      "label": "Estilo y tecnica narrativa",
      "color": "#8b5cf6",
      "children": [
        "Narrador: [tipo y efecto]",
        "Tiempo narrativo: [lineal, flashbacks, etc.]",
        "Recursos: [metaforas, ironia, suspense... con ejemplos]",
        "Ritmo: [descripcion del ritmo narrativo]",
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


# ── Guion del podcast ─────────────────────────────────────────────────────────

async def generate_podcast_script(
    book_title: str,
    author: Optional[str],
    global_summary: str,
    characters: list,
) -> str:
    system = """Eres un guionista de podcasts literarios en espanol.
Creas conversaciones naturales entre dos presentadores:
ANA (analitica, profunda) y CARLOS (entusiasta, empatico).
Formato obligatorio: ANA: [texto] / CARLOS: [texto]"""

    chars_text = "\n".join(
        f"- {c['name']} ({c.get('role','')}: {c.get('personality', '')[:300]}"
        for c in characters[:12]
    ) if characters else "Sin informacion de personajes"

    user = f"""Crea un podcast completo de 15-20 minutos sobre "{book_title}" de {author or "autor desconocido"}.

Resumen global: {global_summary[:8000]}
Personajes principales: {chars_text}

Estructura del podcast (cada seccion debe ser sustancial):
1. INTRODUCCION - presentacion del libro, autor y contexto historico/literario
2. PRIMERA IMPRESION - que tipo de libro es, a quien va dirigido
3. TRAMA - narracion detallada del argumento con todos los giros importantes (con spoilers)
4. PERSONAJES - analisis profundo de los 3-4 personajes mas importantes
5. TEMAS - temas centrales, simbolismo, mensaje del autor
6. PUNTOS FUERTES Y DEBILES - critica literaria honesta
7. COMPARATIVA - similitudes con otras obras del genero
8. VALORACION FINAL - nota y recomendacion
9. DESPEDIDA

Recuerda: ANA es analitica y busca el significado profundo. CARLOS es mas emocional y conecta con el lector comun. Que el dialogo sea natural, con interrupciones y acuerdos."""

    return await _call_ai(system, user, max_tokens=6000)
