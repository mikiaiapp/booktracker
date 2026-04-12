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

async def _call_ai(system: str, user: str, max_tokens: int = 2000, is_fast_task: bool = False, api_keys: dict = None, skip_fallback: bool = False) -> tuple[str, str]:
    api_keys = api_keys or {}
    def clean_k(val): return str(val or "").strip().strip('"').strip("'")
    
    keys = {
        "gemini": clean_k(api_keys.get("gemini") or getattr(settings, 'GEMINI_API_KEY', "") or os.environ.get("GEMINI_API_KEY", "")),
        "groq": clean_k(api_keys.get("groq") or getattr(settings, 'GROQ_API_KEY', "") or os.environ.get("GROQ_API_KEY", "")),
        "openai": clean_k(api_keys.get("openai") or getattr(settings, 'OPENAI_API_KEY', "") or os.environ.get("OPENAI_API_KEY", "")),
    }

    legacy_map = {"gemini-2.5-flash": "gemini-1.5-flash", "gemini-2.5-pro": "gemini-1.5-pro"}
    preferred = (api_keys.get("preferred_model") or settings.AI_MODEL or "gemini-1.5-flash").lower()
    preferred = legacy_map.get(preferred, preferred)

    def get_prov(m_name: str):
        m = m_name.lower()
        if "gemini" in m: return "gemini"
        if any(g in m for g in ["llama", "mixtral"]): return "groq"
        if "gpt" in m: return "openai"
        return None

    models_to_try = []
    p_prov = get_prov(preferred)
    if p_prov and keys.get(p_prov): models_to_try.append(preferred)

    if not skip_fallback:
        standard = ["gemini-1.5-flash", "llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gpt-4o-mini", "gemini-1.5-pro"]
        for m in standard:
            prov = get_prov(m)
            if keys.get(prov) and m not in models_to_try: models_to_try.append(m)

    if not models_to_try: raise ValueError("No hay llaves de API válidas.")

    last_error = ""
    for m in models_to_try:
        try:
            print(f"[AI] Llamando a {m}...")
            provider = get_prov(m)
            api_key = keys[provider]
            if provider == "gemini":
                # Configuración de seguridad permisiva para literatura
                safety = [
                    {"category": "HARM_CATEGORY_HARASSMENT", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_HATE_SPEECH", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE"},
                    {"category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE"},
                ]
                try:
                    from openai import AsyncOpenAI
                    client = AsyncOpenAI(api_key=api_key, base_url="https://generativelanguage.googleapis.com/v1beta/openai/")
                    resp = await client.chat.completions.create(model=m, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}], max_tokens=max_tokens, temperature=0.7)
                    return resp.choices[0].message.content or "", m
                except Exception as e_bridge:
                    print(f"[AI] Gemini Bridge falló: {e_bridge}. Intentando nativo...")
                    import google.generativeai as genai
                    genai.configure(api_key=api_key)
                    mdl = genai.GenerativeModel(m)
                    # Forzamos modo permisivo en llamada nativa
                    response = await asyncio.to_thread(mdl.generate_content, f"{system}\n\n{user}", safety_settings=safety)
                    return (response.text or ""), m
            elif provider == "groq" or provider == "openai":
                from openai import AsyncOpenAI
                base = "https://api.groq.com/openai/v1" if provider == "groq" else None
                client = AsyncOpenAI(api_key=api_key, base_url=base)
                resp = await client.chat.completions.create(model=m, max_tokens=max_tokens, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
                return resp.choices[0].message.content, m
        except Exception as e:
            last_error = str(e)
            print(f"[AI] Fallo en {m}: {last_error}")
            continue
    raise ValueError(f"Falla total. Último error: {last_error}")

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
    system = "Responde SOLO un array JSON: [{\"name\": \"...\", \"is_main\": true/false}]"
    user = f"Identifica personajes principales y secundarios basándote en estos resúmenes:\n{_compress_text(all_summaries)}"
    try:
        raw, m = await _call_ai_with_retry(system, user, 1000, is_fast_task=True, api_keys=api_keys)
        data = _parse_json(raw)
        return ([c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else []), m
    except: return [], "Error"

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