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
        "model": settings.OLLAMA_MODEL, "prompt": prompt, "stream": False,
        "options": {"temperature": 0.5}
    }
    timeout = httpx.Timeout(600.0, connect=10.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(url, json=payload)
        if r.status_code != 200: raise ValueError(f"Ollama Error: {r.text}")
        return r.json()["response"]

def _compress_text(text: str, limit: int = 15000) -> str:
    if not text: return ""
    clean = re.sub(r'\s+', ' ', text).strip()
    return clean[:limit]

import time
from typing import List, Dict, Tuple

# --- Sistema de Descubrimiento Dinámico de IA ---
_MODEL_CACHE = {
    "hierarchy": [],
    "last_update": 0,
    "keys_hash": ""
}

async def _get_dynamic_hierarchy(keys: dict) -> List[Tuple[str, str]]:
    """Obtiene y clasifica los modelos disponibles dinámicamente."""
    global _MODEL_CACHE
    
    # Generar un hash simple de las llaves para detectar cambios
    keys_str = f"{keys.get('gemini')}-{keys.get('groq')}-{keys.get('openai')}"
    
    # Si la caché tiene menos de 24h y las llaves no han cambiado, la usamos
    if _MODEL_CACHE["hierarchy"] and (time.time() - _MODEL_CACHE["last_update"] < 86400) and (_MODEL_CACHE["keys_hash"] == keys_str):
        return _MODEL_CACHE["hierarchy"]

    print("[IA] Descubriendo catálogo de modelos disponible...")
    discovered = []

    # 1. DESCUBRIR GEMINI
    if keys.get("gemini"):
        try:
            import google.generativeai as genai
            genai.configure(api_key=keys["gemini"])
            # Listar modelos que soporten generación de contenido
            for m in genai.list_models():
                if "generateContent" in m.supported_generation_methods:
                    name = m.name.replace("models/", "")
                    score = 100 if "flash" in name else (80 if "pro" in name else 10)
                    discovered.append(("gemini", name, score))
        except Exception as e:
            print(f"[IA] Error descubriendo Gemini: {e}")

    # 2. DESCUBRIR GROQ (OpenAI Compatible)
    if keys.get("groq"):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=keys["groq"], base_url="https://api.groq.com/openai/v1")
            models_res = await client.models.list()
            for m in models_res.data:
                mid = m.id.lower()
                # Priorizar Llama 3.3/3.1 de 70b o Mixtral por ser potentes y gratis
                score = 95 if "llama-3.3" in mid else (90 if "70b" in mid else (85 if "mixtral" in mid else 75))
                discovered.append(("groq", m.id, score))
        except Exception as e:
            print(f"[IA] Error descubriendo Groq: {e}")

    # 3. DESCUBRIR OPENAI
    if keys.get("openai"):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=keys["openai"])
            models_res = await client.models.list()
            for m in models_res.data:
                mid = m.id.lower()
                if "gpt-4o-mini" in mid: discovered.append(("openai", m.id, 50))
                elif "gpt-4o" in mid: discovered.append(("openai", m.id, 40))
        except Exception as e:
            print(f"[IA] Error descubriendo OpenAI: {e}")

    # ORDENAR POR PUNTUACIÓN (MAYOR A MENOR)
    discovered.sort(key=lambda x: x[2], reverse=True)
    
    # Guardar en caché (solo extraemos provider y model_id)
    final_list = [(d[0], d[1]) for d in discovered]
    _MODEL_CACHE = {
        "hierarchy": final_list,
        "last_update": time.time(),
        "keys_hash": keys_str
    }
    
    print(f"[IA] Catálogo actualizado: {len(final_list)} modelos encontrados.")
    return final_list

async def _call_ai(system: str, user: str, max_tokens: int = 2000, is_fast_task: bool = False, api_keys: dict = None, skip_fallback: bool = False) -> tuple[str, str]:
    # 1. Limpieza de llaves
    def ck(v): return str(v or "").strip().strip('"').strip("'")
    current_keys = {
        "gemini": ck(api_keys.get("gemini") or getattr(settings, 'GEMINI_API_KEY', "")),
        "groq": ck(api_keys.get("groq") or getattr(settings, 'GROQ_API_KEY', "")),
        "openai": ck(api_keys.get("openai") or getattr(settings, 'OPENAI_API_KEY', ""))
    }

    # 2. Obtener Jerarquía Dinámica
    dynamic_hierarchy = await _get_dynamic_hierarchy(current_keys)
    pref_model = ck(api_keys.get("preferred_model")).lower() if api_keys else ""
    
    active_queue = []
    
    # - El preferido siempre va primero si está disponible
    if pref_model:
        for prov, m_id in dynamic_hierarchy:
            if m_id.lower() == pref_model:
                active_queue.append((prov, m_id))
                break

    # - Añadir el resto de la jerarquía técnica
    if not skip_fallback:
        for prov, m_id in dynamic_hierarchy:
            if m_id.lower() != pref_model:
                active_queue.append((prov, m_id))

    if not active_queue:
        raise ValueError("No hay modelos disponibles con las API Keys proporcionadas.")

    print(f"[IA] Cola dinámica activa: {' -> '.join([m[1] for m in active_queue])}")

    # 3. Ejecución Secuencial
    last_err = ""
    for prov, m in active_queue:
        token = current_keys.get(prov)
        if not token: continue
        
        try:
            print(f"[IA] Utilizando {m}...")
            if prov == "gemini":
                import google.generativeai as genai
                genai.configure(api_key=token)
                mdl = genai.GenerativeModel(m)
                safety = [{"category": c, "threshold": "BLOCK_NONE"} for c in ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]]
                response = await asyncio.to_thread(mdl.generate_content, f"{system}\n\n{user}", safety_settings=safety)
                if not response or not response.text: raise ValueError("Sin respuesta o bloqueado por seguridad")
                return response.text, m
            
            elif prov == "groq" or prov == "openai":
                from openai import AsyncOpenAI
                base = "https://api.groq.com/openai/v1" if prov == "groq" else None
                client = AsyncOpenAI(api_key=token, base_url=base)
                resp = await client.chat.completions.create(
                    model=m, 
                    max_tokens=max_tokens, 
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}]
                )
                if not resp.choices[0].message.content: raise ValueError("Respuesta vacía del API")
                return resp.choices[0].message.content, m
        except Exception as e:
            last_err = str(e)
            print(f"[IA] Fallo en {m}: {last_err}")
            await asyncio.sleep(2)
            continue

    raise ValueError(f"Todos los modelos de IA fallaron. Último error: {last_err}")

async def _call_ai_with_retry(system, user, max_tokens=2000, max_retries=3, is_fast_task=False, api_keys=None):
    for i in range(max_retries):
        try: return await _call_ai(system, user, max_tokens, is_fast_task, api_keys)
        except Exception as e:
            if i == max_retries-1: raise
            await asyncio.sleep(2*(i+1))

def _parse_json(text: str):
    if not text: return None
    clean = re.sub(r"```(?:json)?\s*|```\s*", "", text).strip()
    try: return json.loads(clean)
    except:
        match = re.search(r'\[[\s\S]*\]|\{[\s\S]*\}', clean)
        if match:
            try: return json.loads(match.group())
            except: pass
    return None

# --- FUNCIONES DE ALTO NIVEL ---

async def summarize_chapter(title, text, book, author, api_keys=None) -> tuple[dict, str]:
    system = "Eres un experto literario. Responde SOLO con JSON."
    user = f"Capítulo: {title} de {book}. Resumen JSON (claves 'summary' y 'key_events'):\n{_compress_text(text)}"
    try:
        raw, m = await _call_ai_with_retry(system, user, 1500, is_fast_task=True, api_keys=api_keys)
        return _parse_json(raw), m
    except: return None, "Error"

async def get_character_list(all_summaries, api_keys=None) -> list:
    if not all_summaries: return [], "Error"
    system = "Experto literario. Identifica TODOS los personajes relevantes. Responde SOLO array JSON: [{\"name\": \"...\", \"is_main\": true}]"
    context = _compress_text(all_summaries, 100000)
    try:
        raw, m = await _call_ai_with_retry(system, f"Lista los personajes de este libro:\n{context}", 1000, is_fast_task=True, api_keys=api_keys)
        data = _parse_json(raw)
        char_list = ([c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else [])
        print(f"[AI] Detectados {len(char_list)} personajes usando {m}")
        return char_list, m
    except Exception as e:
        print(f"[AI] Error detectando personajes: {e}")
        return [], "Error"

async def analyze_single_character(name, is_main, all_summaries, book, api_keys=None) -> dict:
    t = "PRINCIPAL" if is_main else "SECUNDARIO"
    system = "Crítico literario. Responde SOLO con JSON siguiendo el esquema proporcionado."
    user = f"""Analiza al personaje {t}: {name} del libro {book}.
Usa este formato JSON: {{"name":"{name}","role":"...","description":"...","personality":"...","arc":"...","relationships":{{}},"key_moments":[],"quotes":[]}}
Contexto:\n{_compress_text(all_summaries, 12000)}"""
    try:
        raw, m = await _call_ai_with_retry(system, user, 2500, api_keys=api_keys)
        return _parse_json(raw), m
    except: return None, "Error"

async def generate_global_summary(summaries, book, author, api_keys=None):
    system = "Académico literario. Escribe un ensayo magistral en español."
    user = f"Libro: {book} de {author}. Ensayo basado en:\n{_compress_text(summaries, 20000)}"
    return await _call_ai_with_retry(system, user, 4000, api_keys=api_keys)

async def generate_mindmap(summaries, book, api_keys=None):
    system = "Experto en análisis. Responde SOLO con JSON de ramas y niños."
    user = f"Mapa mental JSON para {book}. Contexto:\n{_compress_text(summaries, 15000)}"
    try:
        raw, m = await _call_ai_with_retry(system, user, 4000, is_fast_task=True, api_keys=api_keys)
        return (_parse_json(raw) or {"center": book, "branches": []}), m
    except: return {"center": book, "branches": []}, "Error"

async def generate_podcast_script(title, author, summary, chars, api_keys=None):
    system = "Guionista de podcast. ANA y CARLOS dialogan. Formato ANA: ... / CARLOS: ..."
    user = f"Podcast de {title}. Contexto:\n{_compress_text(summary, 10000)}"
    return await _call_ai_with_retry(system, user, 6000, is_fast_task=True, api_keys=api_keys)

async def talk_to_book(title, author, context, msg, mode="default", history=None, api_keys=None):
    system = f"Experto en {title}. Contexto:\n{_compress_text(context, 20000)}"
    return await _call_ai_with_retry(system, f"Usuario: {msg}", 2000, api_keys=api_keys)

async def test_api_key(provider, key, model=None):
    ks = {provider: key, "preferred_model": model}
    try:
        r, _ = await _call_ai("Responde OK.", "Test.", 10, api_keys=ks, skip_fallback=True)
        return True if r else False
    except Exception as e: raise e