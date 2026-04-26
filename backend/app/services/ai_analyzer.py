import json
import re
import os
import httpx
import asyncio
from typing import Optional
from app.core.config import settings


def _compress_text(text: str, limit: int = 15000) -> str:
    if not text: return ""
    clean = re.sub(r'\s+', ' ', text).strip()
    return clean[:limit]

def _ui_log(user_id, book_id, model, msg=None):
    """Helper para enviar feedback a la UI desde los servicios."""
    if not (user_id and book_id): return
    try:
        from app.workers.queue_manager import update_progress
        # Intentamos no sobreescribir el mensaje principal si no se provee
        update_progress(user_id, book_id, None, None, message=msg, model=model)
    except: pass

import time
from typing import List, Dict, Tuple

# --- Sistema de Descubrimiento Dinámico de IA ---
_MODEL_CACHE = {
    "hierarchy": [],
    "last_update": 0,
    "keys_hash": ""
}
_BLACKLISTED_PROVIDERS = {} # {provider: (expiry_timestamp, reason_msg)}
_GLOBAL_EXHAUSTION_MSG = "" 

async def _get_dynamic_hierarchy(keys: dict, force: bool = False) -> List[Tuple[str, str]]:
    """Obtiene y clasifica los modelos disponibles dinámicamente."""
    global _MODEL_CACHE
    
    # Generar un hash simple de las llaves para detectar cambios
    keys_str = f"{keys.get('gemini')}-{keys.get('groq')}-{keys.get('openai')}"
    
    # Si la caché tiene menos de 24h y las llaves no han cambiado (y no se fuerza refresh), la usamos
    if not force and _MODEL_CACHE["hierarchy"] and (time.time() - _MODEL_CACHE["last_update"] < 86400) and (_MODEL_CACHE["keys_hash"] == keys_str):
        return _MODEL_CACHE["hierarchy"]

    print("[IA] Descubriendo catálogo de modelos disponible...")
    discovered = []

    # 1. DESCUBRIR GEMINI (Filtro estricto)
    if keys.get("gemini"):
        try:
            import google.generativeai as genai
            genai.configure(api_key=keys["gemini"])
            found_any = False
            for m in genai.list_models():
                name = m.name 
                # Solo modelos que soporten generación de contenido
                if "generateContent" in m.supported_generation_methods:
                    # Filtro más relajado: queremos ver qué hay disponible realmente
                    # Solo quitamos los que sabemos que NO son para esto (embeddings, tts)
                    if any(x in name.lower() for x in ["embedding", "tts", "aqa"]): continue
                    
                    # Prioridad por nombre
                    score = 10
                    if "2.0-flash" in name.lower(): score = 100
                    elif "1.5-flash" in name.lower(): score = 90
                    elif "1.5-pro" in name.lower(): score = 80
                    elif "gemini-pro" in name.lower(): score = 70
                    
                    print(f"[IA] Gemini descubierto: {name} (Score: {score})")
                    discovered.append(("gemini", name, score))
                    found_any = True
            
            if not found_any:
                print("[IA] Gemini: list_models no devolvió ningún modelo. Intentando verificación directa...")
                # Algunos API Keys restringidos no permiten list_models pero sí uso directo.
                # Intentamos verificar un modelo estándar.
                try:
                    # get_model es síncrono en la mayoría de versiones de la lib
                    m_verify = genai.get_model("models/gemini-1.5-flash")
                    if m_verify:
                        print(f"[IA] Gemini: Verificación directa exitosa para {m_verify.name}")
                        discovered.append(("gemini", m_verify.name, 90))
                        found_any = True
                except Exception as e_verify:
                    print(f"[IA] Gemini: Falló verificación directa: {e_verify}")

            if not found_any:
                # Si llegamos aquí, realmente no hay nada disponible o la clave es inválida
                print("[IA] Gemini: No se encontró ningún modelo disponible.")

        except Exception as e:
            print(f"[IA] Error descubriendo Gemini: {e}")

    # 2. DESCUBRIR GROQ (Prioridad alta por velocidad)
    if keys.get("groq"):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=keys["groq"], base_url="https://api.groq.com/openai/v1")
            models_res = await client.models.list()
            for m in models_res.data:
                mid = m.id.lower()
                score = 10
                if "llama-3.3-70b" in mid: score = 105
                elif "mixtral-8x7b" in mid: score = 85
                elif "llama-3.1-8b" in mid: score = 70
                
                print(f"[IA] Groq descubierto: {m.id} (Score: {score})")
                discovered.append(("groq", m.id, score))
        except Exception as e:
            print(f"[IA] Error descubriendo Groq: {e}")
            discovered.append(("groq", "llama-3.3-70b-versatile", 105))

    # 3. DESCUBRIR OPENAI
    if keys.get("openai"):
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=keys["openai"])
            models_res = await client.models.list()
            for m in models_res.data:
                mid = m.id.lower()
                if mid in ["gpt-4o", "gpt-4o-mini"]:
                    score = 95 if mid == "gpt-4o" else 75
                    print(f"[IA] OpenAI descubierto: {m.id}")
                    discovered.append(("openai", m.id, score))
        except Exception as e:
            print(f"[IA] Error descubriendo OpenAI: {e}")
            discovered.append(("openai", "gpt-4o-mini", 75))

    # ORDENAR POR PUNTUACIÓN (MAYOR A MENOR)
    discovered.sort(key=lambda x: x[2], reverse=True)
    
    # Guardar en caché
    final_list = [(d[0], d[1]) for d in discovered]
    _MODEL_CACHE = {
        "hierarchy": final_list,
        "last_update": time.time(),
        "keys_hash": keys_str
    }
    
    print(f"[IA] Catálogo actualizado: {len(final_list)} modelos encontrados.")
    return final_list

async def _call_ai(system: str, user: str, max_tokens: int = 2000, is_fast_task: bool = False, api_keys: dict = None, skip_fallback: bool = False, user_id: str = None, book_id: str = None) -> tuple[str, str]:
    # 1. Limpieza de llaves
    def ck(v): return str(v or "").strip().strip('"').strip("'")
    current_keys = {
        "gemini": ck(api_keys.get("gemini") if api_keys else ""),
        "groq": ck(api_keys.get("groq") if api_keys else ""),
        "openai": ck(api_keys.get("openai") if api_keys else "")
    }

    # 2. Obtener Jerarquía Dinámica
    dynamic_hierarchy = await _get_dynamic_hierarchy(current_keys)
    pref_model = ck(api_keys.get("preferred_model")).lower() if api_keys else ""
    
    def normalize_m(name):
        return name.replace("models/", "").lower().strip()

    active_queue = []
    
    # - El preferido siempre va primero
    if pref_model:
        found_in_hierarchy = False
        for prov, m_id in dynamic_hierarchy:
            if normalize_m(m_id) == normalize_m(pref_model):
                active_queue.append((prov, m_id))
                found_in_hierarchy = True
                break
        
        # Si estamos en modo TEST (skip_fallback), forzamos el modelo preferido
        # aunque no se haya "descubierto", para poder ver el error real del proveedor
        # (ej: "API Key invalid" en lugar de "No hay modelos")
        if not found_in_hierarchy and skip_fallback:
            prov_guess = "openai"
            if "gemini" in pref_model: prov_guess = "gemini"
            elif "llama" in pref_model or "mixtral" in pref_model: prov_guess = "groq"
            
            # Asegurar prefijo para Gemini
            m_to_test = pref_model
            if prov_guess == "gemini" and not m_to_test.startswith("models/"):
                m_to_test = f"models/{m_to_test}"
                
            active_queue.append((prov_guess, m_to_test))

    # - Añadir el resto de la jerarquía técnica si no es un test específico
    if not skip_fallback:
        for prov, m_id in dynamic_hierarchy:
            is_already_queued = any(normalize_m(m[1]) == normalize_m(m_id) for m in active_queue)
            if not is_already_queued:
                active_queue.append((prov, m_id))

    if not active_queue:
        raise ValueError("No hay modelos disponibles con las API Keys proporcionadas.")

    print(f"[IA] Cola dinámica activa: {' -> '.join([m[1] for m in active_queue])}")
    _ui_log(user_id, book_id, "Iniciando...", f"Cola: {len(active_queue)} modelos")

    # 3. Ejecución Secuencial
    last_err = ""
    for prov, m in active_queue:
        _ui_log(user_id, book_id, m, f"Consultando {m}...")
        # Saltar si el proveedor está temporalmente bloqueado por cuota (10 min)
        if prov in _BLACKLISTED_PROVIDERS:
            try:
                entry = _BLACKLISTED_PROVIDERS[prov]
                # Soportar tanto float (legacy) como tuple (nuevo)
                expiry_timestamp = entry[0] if isinstance(entry, (tuple, list)) else entry
                if time.time() < expiry_timestamp:
                    print(f"[IA] Saltando {prov} (bloqueado por cuota)")
                    continue
                else:
                    del _BLACKLISTED_PROVIDERS[prov]
            except:
                del _BLACKLISTED_PROVIDERS[prov]

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
            last_err_raw = str(e).lower()
            last_err = last_err_raw
            print(f"[IA] Fallo en {m}: {last_err}")
            
            if "429" in last_err or "quota" in last_err or "limit" in last_err:
                _ui_log(user_id, book_id, "Límite API", "Agotado temporalmente, rotando...")
                # Extraer tiempo de espera si está en el mensaje (solo Groq/Gemini suelen darlo)
                import re
                wait_seconds = 60
                match = re.search(r"in ([\d\.]+)s|in (\d+)m|in (\d+) seconds", last_err)
                if match:
                    if match.group(1): wait_seconds = int(float(match.group(1)))
                    elif match.group(2): wait_seconds = int(match.group(2)) * 60
                    elif match.group(3): wait_seconds = int(match.group(3))

                # Límite DIARIO (Gemini "daily", Groq "tpd" o "tokens per day", o error 429 persistente)
                # Gemini free suele decir: "quota_id: ...daily..."
                if any(x in last_err for x in ["daily", "tpd", "tokens per day", "exhausted"]):
                    # Si no hay tiempo explícito, asumimos que es un reset diario (usamos 1h como ventana de seguridad para reintentar)
                    reset_time = time.time() + max(wait_seconds, 3600) 
                    
                    timestr = time.strftime('%H:%M', time.localtime(reset_time))
                    msg = f"Agotada cuota diaria. Reset estimado: {timestr}"
                    _BLACKLISTED_PROVIDERS[prov] = (reset_time, msg)
                    print(f"[IA] Provider {prov} AGOTADO DIARIAMENTE: {msg}")
                else:
                    # Límite MOMENTÁNEO (TPM/RPM)
                    wait_time = max(wait_seconds, 30 if prov == "groq" else 60)
                    timestr = time.strftime('%H:%M:%S', time.localtime(time.time() + wait_time))
                    _BLACKLISTED_PROVIDERS[prov] = (time.time() + wait_time, f"Saturado hasta {timestr}")
                    print(f"[IA] Provider {prov} saturado. Reintentar en {wait_time}s")
                
                await asyncio.sleep(1)
            else:
                await asyncio.sleep(3)
            continue

    # Si llegamos aquí, avisamos de la situación global
    all_msgs = []
    for p, m in _BLACKLISTED_PROVIDERS.items():
        try:
            exp = m[0] if isinstance(m, (tuple, list)) else m
            if time.time() < exp:
                msg = m[1] if isinstance(m, (tuple, list)) else "Saturado"
                all_msgs.append(f"{p}: {msg}")
        except: pass
    
    err_final = " | ".join(all_msgs) if all_msgs else last_err
    raise ValueError(f"Sin IA disponible: {err_final}")

async def _call_ai_with_retry(system, user, max_tokens=2000, max_retries=3, is_fast_task=False, api_keys=None, user_id=None, book_id=None):
    for i in range(max_retries):
        try: return await _call_ai(system, user, max_tokens, is_fast_task, api_keys, user_id=user_id, book_id=book_id)
        except Exception as e:
            if i == max_retries-1: raise
            _ui_log(user_id, book_id, "Reintentando", f"Fallo {i+1}/{max_retries}. Pausa...")
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

async def summarize_chapter(title, text, book, author, api_keys=None, user_id=None, book_id=None) -> tuple[dict, str]:
    system = """Actúa como un experto crítico literario. Analiza con gran detalle y profundidad el capítulo.
No te limites a un resumen superficial. Tu respuesta debe incluir:
1. Análisis detallado de la trama y eventos clave.
2. Evolución y psicología de los personajes presentes.
3. Temas, simbolismos y subtexto literario del capítulo.
4. Tono y atmósfera narrativa.

Responde ESTRICTAMENTE con un JSON con las claves 'summary' (un texto largo y analítico) y 'key_events' (una lista de puntos críticos)."""
    user = f"Capítulo: '{title}' del libro '{book}' de {author}.\n\nTexto para analizar:\n{_compress_text(text, 30000)}"
    try:
        raw, m = await _call_ai_with_retry(system, user, 3000, is_fast_task=True, api_keys=api_keys, user_id=user_id, book_id=book_id)
        return _parse_json(raw), m
    except Exception as e:
        print(f"[AI] Error en resumen capitulo: {e}")
        raise e

async def get_character_list(all_summaries, api_keys=None, user_id=None, book_id=None) -> list:
    if not all_summaries: return [], "Error"
    system = "Experto literario. Identifica TODOS los personajes relevantes. Responde SOLO array JSON: [{\"name\": \"...\", \"is_main\": true}]"
    context = _compress_text(all_summaries, 12000)
    raw, m = await _call_ai_with_retry(system, f"Lista los personajes de este libro:\n{context}", 1000, is_fast_task=True, api_keys=api_keys, user_id=user_id, book_id=book_id)
    data = _parse_json(raw)
    char_list = ([c for c in data if isinstance(c, dict) and c.get("name")] if isinstance(data, list) else [])
    print(f"[AI] Detectados {len(char_list)} personajes usando {m}")
    return char_list, m

async def analyze_single_character(name, is_main, all_summaries, book, api_keys=None, user_id=None, book_id=None) -> dict:
    t = "PRINCIPAL" if is_main else "SECUNDARIO"
    system = f"""Actúa como un psicólogo narratológico y crítico literario. Realiza un estudio exhaustivo del personaje {t}.
Debes profundizar en:
- Personalidad, virtudes, defectos y motivaciones ocultas.
- Su arco de transformación a lo largo de la obra.
- La complejidad de sus relaciones y su papel temático.

Responde ESTRICTAMENTE con este esquema JSON:
{{"name":"{name}","role":"...","description":"Análisis amplio de su papel","personality":"Estudio psicológico detallado","arc":"Su evolución del inicio al fin","relationships":{{"personaje":"tipo de relación"}},"key_moments":["momento 1", "momento 2"],"quotes":["cita memorable"]}}"""
    user = f"Contexto del libro '{book}' para analizar a '{name}':\n{_compress_text(all_summaries, 10000)}"
    try:
        raw, m = await _call_ai_with_retry(system, user, 3500, api_keys=api_keys, user_id=user_id, book_id=book_id)
        return _parse_json(raw), m
    except Exception as e:
        print(f"[AI] Error en análisis personaje: {e}")
        raise e

async def generate_global_summary(summaries, book, author, api_keys=None, user_id=None, book_id=None):
    system = "Académico literario y ensayista. Escribe un ensayo magistral, profundo y estructurado en español sobre la obra completa."
    user = f"Libro: '{book}' de {author}. Ensayo analítico basado en los resúmenes:\n{_compress_text(summaries, 12000)}"
    return await _call_ai_with_retry(system, user, 4000, api_keys=api_keys, user_id=user_id, book_id=book_id)

async def generate_mindmap(summaries, book, api_keys=None, user_id=None, book_id=None):
    system = """Experto en análisis visual. Genera un mapa mental profundo del libro.
Responde ÚNICAMENTE en formato JSON con esta estructura exacta:
{
  "center": "Título del libro",
  "branches": [
    {
      "label": "Idea Principal o Capítulo",
      "children": ["Detalle clave 1", "Detalle clave 2", "Concepto importante"]
    }
  ]
}"""
    user = f"Contexto para el mapa mental de {book}:\n{_compress_text(summaries, 10000)}"
    try:
        raw, m = await _call_ai_with_retry(system, user, 4000, is_fast_task=True, api_keys=api_keys, user_id=user_id, book_id=book_id)
        return (_parse_json(raw) or {"center": book, "branches": []}), m
    except Exception as e:
        print(f"[AI] Error en mapa mental: {e}")
        raise e

async def generate_podcast_script(title, author, summary, chars, api_keys=None, user_id=None, book_id=None):
    system = "Guionista de podcast. ANA y CARLOS dialogan. Formato ANA: ... / CARLOS: ..."
    user = f"Podcast de {title}. Contexto:\n{_compress_text(summary, 10000)}"
    return await _call_ai_with_retry(system, user, 6000, is_fast_task=True, api_keys=api_keys, user_id=user_id, book_id=book_id)

async def talk_to_book(title, author, context, msg, mode="default", history=None, api_keys=None):
    system = f"Experto en {title}. Contexto:\n{_compress_text(context, 20000)}"
    return await _call_ai_with_retry(system, f"Usuario: {msg}", 2000, api_keys=api_keys)

async def test_api_key(provider, key, model=None):
    ks = {provider: key, "preferred_model": model}
    try:
        r, _ = await _call_ai("Responde OK.", "Test.", 10, api_keys=ks, skip_fallback=True)
        return True if r else False
    except Exception as e: raise e
