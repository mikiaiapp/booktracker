import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings

async def _call_ollama(prompt: str) -> str:
    url = f"{settings.OLLAMA_URL}/api/generate"
    payload = {
        "model": settings.OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.5}
    }
    timeout = httpx.Timeout(600.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(url, json=payload)
        if r.status_code != 200:
            raise ValueError(f"Ollama Error: {r.text}")
        return r.json()["response"]

def _compress_text(text: str) -> str:
    if not text: return ""
    return re.sub(r'\s+', ' ', text).strip()

async def _call_ai(system: str, user: str, max_tokens: int = 2000, is_fast_task: bool = False, api_keys: dict = None, skip_fallback: bool = False) -> tuple[str, str]:
    api_keys = api_keys or {}
    
    # 1. Obtener y limpiar llaves (Scanner de llaves disponibles)
    def clean_k(val): return str(val or "").strip().strip('"').strip("'")
    
    keys = {
        "gemini": clean_k(api_keys.get("gemini") or getattr(settings, 'GEMINI_API_KEY', "") or os.environ.get("GEMINI_API_KEY", "")),
        "groq": clean_k(api_keys.get("groq") or getattr(settings, 'GROQ_API_KEY', "") or os.environ.get("GROQ_API_KEY", "")),
        "openai": clean_k(api_keys.get("openai") or getattr(settings, 'OPENAI_API_KEY', "") or os.environ.get("OPENAI_API_KEY", "")),
    }

    # 2. Traducción de modelos legados (2.5 -> 1.5)
    legacy_map = {
        "gemini-2.5-flash": "gemini-1.5-flash", 
        "gemini-2.5-flash-lite": "gemini-1.5-flash", 
        "gemini-2.5-pro": "gemini-1.5-pro",
        "gemini-2.0-flash": "gemini-2.0-flash-exp"
    }
    preferred = (api_keys.get("preferred_model") or settings.AI_MODEL).lower()
    preferred = legacy_map.get(preferred, preferred)

    def get_prov(m_name: str):
        m_name = m_name.lower()
        if "gemini" in m_name: return "gemini"
        if any(g in m_name for g in ["llama", "mixtral"]): return "groq"
        if "gpt" in m_name: return "openai"
        return None

    # 3. Construir cola de modelos DINÁMICA basándose en las LLAVES cargadas
    models_to_try = []
    
    # Prioridad 1: Tu Selección Personal (siempre que tengas su llave)
    p_prov = get_prov(preferred)
    if p_prov and keys.get(p_prov):
        models_to_try.append(preferred)

    # Prioridad 2: Fallbacks Lógicos (solo de proveedores con llave activa)
    if not skip_fallback:
        # Fallbacks universales (en orden de coste/eficiencia preferido)
        standard_list = ["gemini-1.5-flash", "llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gpt-4o-mini", "gemini-1.5-pro", "gpt-4o"]
        for m in standard_list:
            prov = get_prov(m)
            if keys.get(prov) and m not in models_to_try:
                models_to_try.append(m)

    if not models_to_try:
        raise ValueError("No se ha configurado ninguna clave de API válida para usar IA.")

    last_error = ""
    for m in models_to_try:
        try:
            print(f"[AI] Conectando con {m}...")
            provider = get_prov(m)
            api_key = keys[provider]
            
            if provider == "gemini":
                # Gemini es especial: intentamos Bridge y luego Nativo
                try:
                    from openai import AsyncOpenAI
                    client = AsyncOpenAI(api_key=api_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
                    resp = await client.chat.completions.create(
                        model=m, 
                        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}], 
                        max_tokens=max_tokens, 
                        temperature=0.5
                    )
                    content = resp.choices[0].message.content or ""
                    return content, m
                except Exception:
                    import google.generativeai as genai
                    genai.configure(api_key=api_key)
                    mdl = genai.GenerativeModel(m)
                    # Forzamos ejecución asíncrona segura
                    response = await asyncio.to_thread(mdl.generate_content, f"{system}\n\n{user}")
                    return (response.text or ""), m
            
            elif provider == "groq":
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")
                resp = await client.chat.completions.create(model=m, max_tokens=max_tokens, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
                return resp.choices[0].message.content, m

            elif provider == "openai":
                from openai import AsyncOpenAI
                client = AsyncOpenAI(api_key=api_key)
                resp = await client.chat.completions.create(model=m, max_tokens=max_tokens, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
                return resp.choices[0].message.content, m

        except Exception as e:
            last_error = str(e)
            print(f"[AI] Intento con {m} fallido: {last_error}")
            continue

    raise ValueError(f"No se pudo completar la tarea con ninguna de tus IA. Último error: {last_error}")

async def _call_ai_with_retry(system: str, user: str, max_tokens: int = 2000, max_retries: int = 5, is_fast_task: bool = False, api_keys: dict = None) -> tuple[str, str]:
    for attempt in range(max_retries):
        try:
            return await _call_ai(system, user, max_tokens, is_fast_task, api_keys=api_keys)
        except Exception as e:
            if attempt == max_retries - 1:
                print(f"AI Call failed after {max_retries} attempts: {e}")
                raise
            err_str = str(e)
            sleep_time = (attempt + 1) * 4
            if "Rate limit" in err_str or "Too Many Requests" in err_str or "429" in err_str:
                sleep_time = 15 + (attempt * 10)
                print(f"Límite de API. Reintentando en {sleep_time}s...")
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

# --- FUNCIONES DE ANÁLISIS ---

async def summarize_chapter(chapter_title, text, book_title, author, api_keys: dict = None) -> tuple[dict, str]:
    system = "Eres un erudito literario de España. Responde SOLO con JSON válido."
    compressed_text = _compress_text(text)[:30000]
    user = (
        f"Libro: \u00ab{book_title}\u00bb de {author}.\n"
        f"Capítulo: \u00ab{chapter_title}\u00bb\n\n"
        f"Realiza un resumen magistral en JSON con claves 'summary' (mínimo 250 palabras) y 'key_events':\n{compressed_text}"
    )
    try:
        raw, model_name = await _call_ai_with_retry(system, user, 2000, is_fast_task=True, api_keys=api_keys)
        parsed = _parse_json(raw)
        if not parsed: return None, model_name
        if "summary" not in parsed: parsed["summary"] = next((v for v in parsed.values() if isinstance(v, str) and len(v) > 100), "")
        return (parsed if parsed.get("summary") else None), model_name
    except: return None, "Error"

async def get_character_list(all_summaries: str, api_keys: dict = None) -> list:
    if not all_summaries: return [], "Error"
    system = "Experto literario de España. Identifica personajes con nombre propio. Responde SOLO array JSON: [{\"name\": \"...\", \"is_main\": true/false}]"
    user = f"Resúmenes:\n{all_summaries[:25000]}"
    try:
        raw, model_name = await _call_ai_with_retry(system, user, 1000, is_fast_task=True, api_keys=api_keys)
        data = _parse_json(raw)
        return ([c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else []), model_name
    except: return [], "Error"

async def extract_key_events_from_summary(summary_text: str, api_keys: dict = None) -> list:
    system = "Extrae entre 3 y 5 eventos clave. Responde SOLO array JSON de strings."
    try:
        raw, model_name = await _call_ai_with_retry(system, f"Resumen:\n{summary_text}", 600, is_fast_task=True, api_keys=api_keys)
        data = _parse_json(raw)
        return ([str(x).strip() for x in data] if isinstance(data, list) else []), model_name
    except: return [], "Error"

async def analyze_single_character(name: str, is_main: bool, all_summaries: str, book_title: str, api_keys: dict = None) -> dict:
    system = "Crítico literario de la RAE. Realiza un estudio psicológico monumental. Responde SOLO en JSON."
    user = f"Libro: {book_title}. Analiza el personaje: {name}.\nContexto:\n{all_summaries[:25000]}"
    try:
        raw, model_name = await _call_ai_with_retry(system, user, 3500, api_keys=api_keys)
        return _parse_json(raw), model_name
    except: return None, "Error"

async def generate_global_summary(all_summaries: str, book_title: str, author: str, api_keys: dict = None) -> tuple[str, str]:
    system = "Académico de la lengua de España. Escribe un ensayo literario magistral."
    try:
        return await _call_ai_with_retry(system, f"Libro: {book_title} de {author}.\nResúmenes:\n{all_summaries[:30000]}", 5000, api_keys=api_keys)
    except: return "", "Error"

async def generate_mindmap(all_summaries: str, book_title: str, api_keys: dict = None) -> dict:
    system = "Genera un mapa mental completo en JSON con 8 ramas: Trama, Subtramas, Personajes, Relaciones, Temas, Escenarios, Símbolos y Estilo."
    try:
        raw, model_name = await _call_ai_with_retry(system, f"Resúmenes:\n{all_summaries[:25000]}", 5000, is_fast_task=True, api_keys=api_keys)
        return (_parse_json(raw) or {"center": book_title, "branches": []}), model_name
    except: return {"center": book_title, "branches": []}, "Error"

async def generate_podcast_script(book_title, author, summary, chars, api_keys: dict = None) -> tuple[str, str]:
    system = "Guionista de podcast literario. ANA y CARLOS dialogan. Formato ANA: [texto] / CARLOS: [texto]."
    try:
        return await _call_ai_with_retry(system, f"Libro: {book_title}. Resumen:\n{summary[:10000]}", 8000, is_fast_task=True, api_keys=api_keys)
    except: return "", "Error"

async def talk_to_book(book_title: str, author: str, context: str, user_msg: str, mode: str = "default", history: list = None, api_keys: dict = None) -> tuple[str, str]:
    system = f"Eres un experto en la obra {book_title}. Contexto:\n{context[:30000]}"
    hist_str = "\n".join([f"{h['role'].upper()}: {h['content']}" for h in history[-8:]]) if history else ""
    try:
        return await _call_ai_with_retry(system, f"Historial:\n{hist_str}\n\nUSUARIO: {user_msg}", 2500, api_keys=api_keys)
    except: return "Error crítico.", "Error"

async def test_api_key(provider: str, api_key: str, model: Optional[str] = None) -> bool:
    """Verifica una clave realizando una llamada mínima."""
    keys = {provider: api_key, "preferred_model": model}
    try:
        resp, _ = await _call_ai("Responde OK.", "Test.", max_tokens=20, api_keys=keys, skip_fallback=True)
        return True if resp else False
    except Exception as e:
        print(f"Test failed: {e}")
        raise e