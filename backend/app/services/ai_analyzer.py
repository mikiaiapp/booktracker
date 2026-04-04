# --- VERSION OPTIMIZADA DE ANALISIS DE PERSONAJES ---

async def analyze_characters(all_summaries: str, book_title: str, on_progress=None) -> list:
    """
    Analisis optimizado: 
    - Reduce el peso del JSON para evitar truncamientos.
    - Usa un max_tokens realista (3500) para asegurar que el JSON cierre correctamente.
    - Consolida campos para ahorrar tokens de salida.
    """
    import asyncio as _asyncio

    system = (
        "Eres un experto literario. Responde UNICAMENTE con un array JSON. "
        "Sé conciso y directo. No inventes datos no presentes en los resumenes."
    )

    # Limitamos el contexto de entrada para ahorrar tokens de entrada (aprox 12k chars)
    ctx = all_summaries[:12000]

    # Esquema simplificado para evitar que la IA se extienda demasiado
    schema_main = """{
  "name": "Nombre",
  "aliases": [],
  "role": "protagonist|antagonist",
  "description": "Fisico y origen (breve)",
  "personality": "Rasgos, motivaciones y evolucion (max 3 frases)",
  "key_moments": ["momento 1", "momento 2"],
  "relationships": {"Nombre": "vinculo"}
}"""

    schema_secondary = """{
  "name": "Nombre",
  "role": "secondary|minor",
  "description": "Funcion en la trama y descripcion breve (1 frase)"
}"""

    # --- Pasada 1: Principales (Detalle moderado) ---
    prompt_main = f"""Libro: "{book_title}"
Resumenes: {ctx}

Tarea: Array JSON de protagonistas y antagonistas. 
Formato: {schema_main}
IMPORTANTE: No te extiendas, ve al grano para evitar que el JSON se corte."""

    # --- Pasada 2: Secundarios (Muy concisos) ---
    prompt_secondary = f"""Libro: "{book_title}"
Resumenes: {ctx}

Tarea: Array JSON de personajes secundarios y menores mencionados.
Formato: {schema_secondary}
IMPORTANTE: Usa solo 1-2 frases por personaje. Incluye a todos los que tengan nombre."""

    async def _safe_call(prompt, label, tokens=3500):
        try:
            print(f"[characters] Llamando a IA para {label}...")
            # Timeout de 150s es suficiente para 3500 tokens
            raw = await _asyncio.wait_for(_call_ai(system, prompt, max_tokens=tokens), timeout=150)
            parsed = _parse_json(raw)
            return [c for c in (parsed if isinstance(parsed, list) else []) if isinstance(c, dict) and c.get("name")]
        except Exception as e:
            print(f"[characters] Error en {label}: {e}")
            return []

    # Ejecutamos ambas pasadas
    # Nota: No usamos gather para no saturar la tasa de cuota (rate limit) de cuentas prepago
    chars_main = await _safe_call(prompt_main, "principales")
    
    # Pequeña pausa para evitar Rate Limit Error en APIs prepago
    await _asyncio.sleep(2) 
    
    chars_secondary = await _safe_call(prompt_secondary, "secundarios", tokens=3000)

    # --- Mezclar y Deduplicar ---
    def _norm(n: str) -> str:
        return re.sub(r"\s+", "", n.lower().strip()) if n else ""

    seen = set()
    combined = []

    for char in (chars_main + chars_secondary):
        name_norm = _norm(char.get("name", ""))
        if name_norm and name_norm not in seen:
            seen.add(name_norm)
            # Asegurar que los campos que faltan en secundarios existan para evitar errores en la UI
            if "personality" not in char: char["personality"] = char.get("description", "")
            if "key_moments" not in char: char["key_moments"] = []
            if "relationships" not in char: char["relationships"] = {}
            combined.append(char)

    print(f"[characters] Total final: {len(combined)} personajes procesados.")
    return combined