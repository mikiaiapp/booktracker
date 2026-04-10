import os
import requests
from openai import AsyncOpenAI
import google.generativeai as genai
from app.core.config import settings

# --- Helpers de configuración dinámica ---

def _get_api_key(service: str, user_keys: dict = None) -> str:
    if user_keys:
        if service == "gemini" and user_keys.get("gemini"): return user_keys["gemini"]
        if service == "openai" and user_keys.get("openai"): return user_keys["openai"]
    return settings.GEMINI_API_KEY if service == "gemini" else settings.OPENAI_API_KEY

def _get_preferred_model(user_keys: dict = None) -> str:
    if user_keys and user_keys.get("preferred_model"): return user_keys["preferred_model"]
    return settings.AI_MODEL

# --- Funciones de Identificación ---

async def identify_book(file_path: str, file_type: str, raw_title: str, cover_dir: str, book_id: str, api_keys: dict = None):
    """
    Usa IA para extraer título, autor e ISBN si es posible.
    """
    key = _get_api_key("gemini", api_keys)
    genai.configure(api_key=key)
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    
    prompt = f"Identifica este libro a partir de su nombre de archivo o título parcial: '{raw_title}'. "
    prompt += "Responde exclusivamente en JSON con: title, author, isbn, genre, year, synopsis."
    
    try:
        resp = await model.generate_content_async(prompt)
        import json
        data = json.loads(resp.text.strip().replace('```json', '').replace('```', ''))
        
        # Intentar descargar portada si tenemos título y autor
        if data.get("title") and data.get("author"):
            cover_url = await _get_cover_url(data["title"], data["author"])
            if cover_url:
                data["cover_url"] = cover_url
                local_path = os.path.join(cover_dir, f"{book_id}.jpg")
                os.makedirs(cover_dir, exist_ok=True)
                if await _download_image(cover_url, local_path):
                    data["cover_local"] = f"/covers/{os.path.basename(cover_dir)}/{book_id}.jpg"

        # Enriquecer con biografía del autor
        if data.get("author"):
            data["author_bio"] = await get_author_bio_in_spanish(data["author"], api_keys=api_keys)
            data["author_bibliography"] = await get_author_bibliography(data["author"], api_keys=api_keys)

        return data
    except Exception as e:
        print(f"[IDENTIFIER] Error identificando libro: {e}")
        return {"title": raw_title, "status": "error"}

async def get_author_bio_in_spanish(author_name: str, api_keys: dict = None):
    key = _get_api_key("gemini", api_keys)
    genai.configure(api_key=key)
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    prompt = f"Escribe una biografía concisa y fascinante en español de {author_name}. Un párrafo de unas 150 palabras."
    try:
        r = await model.generate_content_async(prompt)
        return r.text
    except: return None

async def get_author_bibliography(author_name: str, api_keys: dict = None):
    key = _get_api_key("gemini", api_keys)
    genai.configure(api_key=key)
    model = genai.GenerativeModel('gemini-1.5-flash-latest')
    prompt = f"Genera una lista de los 10 mejores libros de {author_name}. Devuelve exclusivamente un JSON: "
    prompt += "[{'title': '...', 'year': 1234, 'isbn': '...', 'synopsis': '...', 'cover_url': '...'}]"
    try:
        r = await model.generate_content_async(prompt)
        import json
        return json.loads(r.text.strip().replace('```json', '').replace('```', ''))
    except: return []

async def _get_cover_url(title: str, author: str):
    query = f"{title} {author} book cover"
    url = f"https://www.googleapis.com/books/v1/volumes?q={query.replace(' ', '+')}&maxResults=1"
    try:
        r = requests.get(url)
        data = r.json()
        return data["items"][0]["volumeInfo"]["imageLinks"]["thumbnail"].replace("http:", "https:")
    except: return None

async def _download_image(url: str, path: str):
    try:
        r = requests.get(url, stream=True)
        if r.status_code == 200:
            with open(path, 'wb') as f:
                for chunk in r: f.write(chunk)
            return True
    except: return False
