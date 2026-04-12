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
    # 1. Limpieza y validación de llaves
    def ck(v): return str(v or "").strip().strip('"').strip("'")
    keys = {
        "gemini": ck(api_keys.get("gemini") or getattr(settings, 'GEMINI_API_KEY', "")),
        "groq": ck(api_keys.get("groq") or getattr(settings, 'GROQ_API_KEY', "")),
        "openai": ck(api_keys.get("openai") or getattr(settings, 'OPENAI_API_KEY', ""))
    }

    # 2. Construcción de la Pirámide de Supervivencia (Modelos Disponibles)
    preferred = (api_keys.get("preferred_model") or "gemini-1.5-flash").lower()
    if "2.5" in preferred: preferred = preferred.replace("2.5", "1.5")

    def get_prov(m):
        m = str(m).lower()
        if "gemini" in m: return "gemini"
        if "llama" in m or "mix" in m: return "groq"
        if "gpt" in m: return "openai"
        return None

    # Creamos la cola dinámica real
    q = []
    
    # - Añadir preferido si tiene llave
    p_prov = get_prov(preferred)
    if p_prov and keys.get(p_prov):
        q.append(preferred)

    if not skip_fallback:
        # - Bloque Gratuito Obligatorio (Si hay llaves)
        free_tier = ["gemini-1.5-flash", "llama-3.3-70b-versatile", "mixtral-8x7b-32768", "gemini-1.5-pro"]
        for m in free_tier:
            prov = get_prov(m)
            if keys.get(prov) and m not in q:
                q.append(m)
        
        # - Bloque de Pago (Solo si el resto falla)
        if keys.get("openai"):
            for m in ["gpt-4o-mini", "gpt-4o"]:
                if m not in q: q.append(m)

    if not q:
        raise ValueError("Configuración de IA vacía: No has introducido ninguna API Key válida.")

    print(f"[IA] Jerarquía dinámica para esta tarea: {' -> '.join(q)}")

    # 3. Ejecución Secuencial
    last_err = ""
    for m in q:
        prov = get_prov(m)
        token = keys[prov]
        try:
            print(f"[IA] Intentando con {m}...")
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
            print(f"[IA] Fallo en {m}: {last_err[:80]}...")
            continue

    raise ValueError(f"Agotados todos los modelos configurados. Error final: {last_err}")

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
    # Aumentamos el límite a 100k para aprovechar el contexto de Gemini
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