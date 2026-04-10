import os
import json
from openai import AsyncOpenAI
from google import generativeai as genai
from app.core.config import settings

# --- Helpers de configuración dinámica ---

def _get_api_key(service: str, user_keys: dict = None) -> str:
    """Prioriza la clave del usuario sobre la global."""
    if user_keys:
        if service == "gemini" and user_keys.get("gemini"): return user_keys["gemini"]
        if service == "openai" and user_keys.get("openai"): return user_keys["openai"]
        if service == "anthropic" and user_keys.get("anthropic"): return user_keys["anthropic"]
    
    if service == "gemini": return settings.GEMINI_API_KEY
    if service == "openai": return settings.OPENAI_API_KEY
    return None

def _get_preferred_model(user_keys: dict = None) -> str:
    """Prioriza el modelo del usuario sobre el global."""
    if user_keys and user_keys.get("preferred_model"):
        return user_keys["preferred_model"]
    return settings.AI_MODEL

# --- Motor Central de IA ---

async def _call_ai(prompt: str, system: str = "Eres un experto crítico literario.", model: str = None, api_keys: dict = None):
    """
    Función unificada para llamadas a IA con soporte para múltiples proveedores y fallback.
    """
    target_model = model or _get_preferred_model(api_keys)
    
    # 1. Intentar GPT-4o o GPT-4o-mini
    if "gpt-4" in target_model.lower():
        try:
            key = _get_api_key("openai", api_keys)
            if not key: raise Exception("No OpenAI API Key")
            client = AsyncOpenAI(api_key=key)
            resp = await client.chat.completions.create(
                model=target_model,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                temperature=0.7
            )
            return resp.choices[0].message.content, target_model
        except Exception as e:
            print(f"[AI] Error OpenAI ({target_model}): {e}. Reintentando con Gemini...")
            target_model = "gemini-1.5-flash-latest"

    # 2. Intentar Gemini
    if "gemini" in target_model.lower():
        try:
            key = _get_api_key("gemini", api_keys)
            if not key: raise Exception("No Gemini API Key")
            genai.configure(api_key=key)
            # Limpiar nombre del modelo si viene con prefijo raro
            clean_model = target_model.replace("models/", "")
            m = genai.GenerativeModel(clean_model, system_instruction=system)
            resp = await m.generate_content_async(prompt)
            return resp.text, target_model
        except Exception as e:
            print(f"[AI] Error Gemini ({target_model}): {e}")
            # Si Gemini falla (ej. 404), intentar GPT-4o-mini como último recurso si hay clave
            if "gpt-4" not in target_model.lower():
                try:
                    key_oa = _get_api_key("openai", api_keys)
                    if key_oa:
                        client = AsyncOpenAI(api_key=key_oa)
                        resp = await client.chat.completions.create(
                            model="gpt-4o-mini",
                            messages=[{"role": "system", "content": system}, {"role": "user", "content": prompt}],
                            temperature=0.7
                        )
                        return resp.choices[0].message.content, "gpt-4o-mini (fallback)"
                except: pass
            raise e

    raise Exception(f"Modelo {target_model} no soportado o sin configuración.")


# --- Servicios de Análisis ---

async def summarize_chapter(title: str, text: str, book_title: str, author: str, api_keys: dict = None):
    system = "Eres un experto en análisis literario. Resumes capítulos de forma profunda y narrativa."
    prompt = f"Libro: '{book_title}' de {author}. Capítulo: {title}.\n\nTexto:\n{text}\n\n"
    prompt += "Genera un JSON con: 'summary' (resumen detallado de ~500 palabras) y 'key_events' (lista de los 5 hechos más importantes)."
    
    raw, model = await _call_ai(prompt, system=system, api_keys=api_keys)
    try:
        data = json.loads(raw.strip().replace('```json', '').replace('```', ''))
        return data, model
    except:
        return {"summary": raw, "key_events": []}, model

async def get_character_list(all_summaries: str, api_keys: dict = None):
    system = "Extraes personajes de un libro. Devuelves exclusivamente un JSON."
    prompt = f"Basándote en estos resúmenes, identifica los personajes principales y secundarios:\n\n{all_summaries}\n\n"
    prompt += "Devuelve un JSON: [{'name': '...', 'is_main': true/false}, ...]"
    
    raw, model = await _call_ai(prompt, system=system, api_keys=api_keys)
    try:
        return json.loads(raw.strip().replace('```json', '').replace('```', '')), model
    except:
        return [], model

async def analyze_single_character(name: str, is_main: bool, all_summaries: str, book_title: str, api_keys: dict = None):
    system = "Eres un psicólogo y experto literario analizando la profundidad de los personajes."
    prompt = f"Analiza en profundidad al personaje '{name}' de '{book_title}'.\n\nContexto:\n{all_summaries}\n\n"
    prompt += "Devuelve un JSON con: 'description', 'personality', 'arc' (evolución), 'relationships' (dict char:relacion), 'first_appearance', 'quotes' (lista)."
    
    raw, model = await _call_ai(prompt, system=system, api_keys=api_keys)
    try:
        return json.loads(raw.strip().replace('```json', '').replace('```', '')), model
    except:
        return {"description": raw}, model

async def generate_global_summary(all_summaries: str, book_title: str, author: str, api_keys: dict = None):
    system = "Eres un ensayista literario de prestigio."
    prompt = f"Escribe un ensayo profundo sobre '{book_title}' de {author}.\n\nResúmenes de apoyo:\n{all_summaries}\n\n"
    prompt += "El ensayo debe cubrir: temáticas principales, estilo narrativo, mensaje del autor y una conclusión crítica."
    return await _call_ai(prompt, system=system, api_keys=api_keys)

async def generate_mindmap(all_summaries: str, book_title: str, api_keys: dict = None):
    system = "Eres un experto en visualización de datos literarios. Devuelves JSON para Mermaid."
    prompt = f"Crea una estructura jerárquica para un mapa mental de '{book_title}'.\n{all_summaries}\n"
    prompt += "Devuelve un JSON con 'nodes' y 'links' estilo D3/Mermaid."
    
    raw, model = await _call_ai(prompt, system=system, api_keys=api_keys)
    try:
        return json.loads(raw.strip().replace('```json', '').replace('```', '')), model
    except:
        return {"error": "JSON invatido"}, model

async def generate_podcast_script(title: str, author: str, global_summary: str, characters: list, api_keys: dict = None):
    system = "Eres un guionista de podcasts literarios de éxito."
    prompt = f"Genera un guion de podcast de 5 minutos sobre '{title}' de {author}.\nResumen:\n{global_summary}\nPersonajes:\n{str(characters)}\n"
    prompt += "El podcast es una conversación entre dos presentadores (Alex y Sam) que destripan el libro."
    return await _call_ai(prompt, system=system, api_keys=api_keys)

async def extract_key_events_from_summary(summary: str, api_keys: dict = None):
    """Repara capítulos que perdieron sus hitos."""
    system = "Extraes hitos clave de resúmenes literarios."
    prompt = f"Extrae una lista JSON de los 5 hitos más relevantes de este texto:\n\n{summary}"
    raw, model = await _call_ai(prompt, system=system, api_keys=api_keys)
    try:
        return json.loads(raw.strip().replace('```json', '').replace('```', '')), model
    except:
        return [], model
