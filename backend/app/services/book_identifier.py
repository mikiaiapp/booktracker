"""
Phase 1: Identify book and gather metadata.
1. Extract hints from the file (title, author from metadata)
2. Search Open Library + Google Books for book data
3. Search Wikipedia + Open Library for author bio
4. Download cover image
"""
import httpx
import re
import os
from urllib.parse import quote
from typing import Optional
import fitz  # PyMuPDF
from app.core.config import settings


async def identify_book(file_path: str, file_type: str, fallback_title: str) -> dict:
    hints = await extract_file_hints(file_path, file_type)
    title = hints.get("title") or fallback_title
    author = hints.get("author")
    metadata = await search_book_metadata(title, author)
    if metadata.get("cover_url"):
        local_cover = await download_cover(metadata["cover_url"], file_path)
        if local_cover:
            metadata["cover_local"] = local_cover
    return metadata


async def extract_file_hints(file_path: str, file_type: str) -> dict:
    hints = {}
    try:
        if file_type == "pdf":
            doc = fitz.open(file_path)
            meta = doc.metadata
            hints["title"] = meta.get("title") or ""
            hints["author"] = meta.get("author") or ""
            if not hints["title"] and doc.page_count > 0:
                text = doc[0].get_text()
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                if lines:
                    hints["title"] = lines[0][:100]
            doc.close()
        elif file_type == "epub":
            import ebooklib
            from ebooklib import epub
            book = epub.read_epub(file_path)
            hints["title"] = book.get_metadata("DC", "title")[0][0] if book.get_metadata("DC", "title") else ""
            hints["author"] = book.get_metadata("DC", "creator")[0][0] if book.get_metadata("DC", "creator") else ""
    except Exception as e:
        print(f"Error extracting hints: {e}")
    return hints


async def search_book_metadata(title: str, author: Optional[str] = None) -> dict:
    query = f"{title} {author or ''}".strip()
    metadata = {"title": title, "author": author}

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        # Open Library
        try:
            ol_data = await search_open_library(client, query)
            if ol_data:
                metadata.update(ol_data)
        except Exception as e:
            print(f"Open Library error: {e}")

        # Google Books
        try:
            gb_data = await search_google_books(client, query)
            if gb_data:
                for k, v in gb_data.items():
                    if not metadata.get(k):
                        metadata[k] = v
        except Exception as e:
            print(f"Google Books error: {e}")

        # 1. Intentar generar synopsis con IA (completa, 250-400 palabras)
        if not metadata.get("synopsis") or len(metadata.get("synopsis", "")) < 200:
            try:
                from app.services.ai_analyzer import _call_ai
                book_title = metadata.get("title") or title
                book_author = metadata.get("author") or author or "autor desconocido"
                year = metadata.get("year", "")
                genre = metadata.get("genre", "")
                system = "Eres un experto literario. Escribe en español con precisión y detalle."
                user = f"""Escribe una sinopsis completa e informativa (mínimo 250 palabras, máximo 400) del libro:
Título: "{book_title}"
Autor: {book_author}
{f"Año: {year}" if year else ""}
{f"Género: {genre}" if genre else ""}

Incluye: argumento principal, contexto histórico o social si es relevante, personajes clave y tono narrativo.
Escribe en tercera persona, sin spoilers del final. No empieces con "En este libro" ni "Este libro"."""
                synopsis = await _call_ai(system, user, max_tokens=800)
                if synopsis and len(synopsis) > 150:
                    metadata["synopsis"] = synopsis.strip()
                    print(f"AI synopsis generated: {len(synopsis)} chars")
            except Exception as e:
                print(f"AI synopsis error: {e}")

        # Si la IA no pudo generar synopsis (cuota agotada), se deja vacía
        # El usuario puede pulsar Reidentificar cuando se restablezca la cuota

        # Author bio + bibliography
        author_name = metadata.get("author") or author
        if author_name:
            # Wikipedia (es + en)
            if not metadata.get("author_bio"):
                try:
                    bio_data = await search_wikipedia_author(client, author_name)
                    if bio_data:
                        metadata.update(bio_data)
                except Exception as e:
                    print(f"Wikipedia error: {e}")

            # Bibliografía via Google Books (más fiable que Open Library)
            author_name = metadata.get("author") or author
            if author_name:
                try:
                    biblio = await get_author_bibliography(author_name)
                    if biblio:
                        metadata["author_bibliography"] = biblio
                except Exception as e:
                    print(f"Bibliography error: {e}")

        # Limpiar clave interna
        metadata.pop("_ol_author_key", None)

    return metadata


async def search_open_library(client: httpx.AsyncClient, query: str) -> dict:
    url = f"https://openlibrary.org/search.json?q={quote(query)}&limit=1"
    r = await client.get(url)
    data = r.json()
    if not data.get("docs"):
        return {}
    doc = data["docs"][0]
    result = {}
    result["title"] = doc.get("title", "")
    if doc.get("author_name"):
        result["author"] = doc["author_name"][0]
    if doc.get("isbn"):
        result["isbn"] = doc["isbn"][0]
    if doc.get("first_publish_year"):
        result["year"] = doc["first_publish_year"]
    if doc.get("number_of_pages_median"):
        result["pages"] = doc["number_of_pages_median"]
    if doc.get("language"):
        result["language"] = doc["language"][0] if doc["language"] else None
    if doc.get("cover_i"):
        result["cover_url"] = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-L.jpg"
    if doc.get("description"):
        desc = doc["description"]
        result["synopsis"] = desc.get("value", desc) if isinstance(desc, dict) else str(desc)
    elif doc.get("first_sentence"):
        result["synopsis"] = doc["first_sentence"].get("value", "")
    # Guardar author_key para obtener bibliografía después
    if doc.get("author_key"):
        result["_ol_author_key"] = doc["author_key"][0]
    return result


async def get_author_bibliography(author_name: str) -> list:
    """Obtiene bibliografía del autor via Google Books con metadatos completos."""
    url = f"https://www.googleapis.com/books/v1/volumes?q=inauthor:{quote(author_name)}&maxResults=40&orderBy=newest"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
            r = await c.get(url)
        if r.status_code != 200:
            return []
        items = r.json().get("items", [])
        seen_isbn = set()
        seen_title = set()
        results = []
        for item in items:
            info = item.get("volumeInfo", {})
            title = info.get("title", "").strip()
            authors = info.get("authors", [])
            if not title or not authors:
                continue
            # Solo libros donde el autor es el principal
            if author_name.lower() not in " ".join(authors).lower():
                continue
            
            # Extraer ISBN
            isbn = None
            for ident in info.get("industryIdentifiers", []):
                if ident.get("type") in ("ISBN_13", "ISBN_10"):
                    isbn = ident.get("identifier")
                    break
            
            # Deduplicar por ISBN primero, luego por título normalizado
            title_key = title.lower()
            if isbn:
                if isbn in seen_isbn:
                    continue
                seen_isbn.add(isbn)
            else:
                if title_key in seen_title:
                    continue
            seen_title.add(title_key)
            
            # Extraer año de publicación
            year = None
            if info.get("publishedDate"):
                try:
                    year_str = info["publishedDate"][:4]
                    if year_str.isdigit():
                        year = int(year_str)
                except:
                    pass
            
            # Extraer portada (preferir thumbnail grande)
            cover_url = None
            if info.get("imageLinks"):
                cover_url = (
                    info["imageLinks"].get("large") or
                    info["imageLinks"].get("medium") or
                    info["imageLinks"].get("thumbnail")
                )
                if cover_url:
                    cover_url = cover_url.replace("http://", "https://")
            
            # Extraer sinopsis
            synopsis = info.get("description", "")
            
            results.append({
                "title": title,
                "isbn": isbn,
                "year": year,
                "cover_url": cover_url,
                "synopsis": synopsis[:500] if synopsis else None  # Limitar a 500 chars
            })
        
        # Ordenar por año descendente (más reciente primero)
        results.sort(key=lambda x: x.get("year") or 0, reverse=True)
        
        print(f"Google Books bibliography: {len(results)} titles for {author_name}")
        return results  # Sin límite - devolver todos los libros encontrados
    except Exception as e:
        print(f"Google Books bibliography error: {e}")
        return []


async def search_google_books(client: httpx.AsyncClient, query: str) -> dict:
    # Sin API key para evitar restricciones de permisos
    url = f"https://www.googleapis.com/books/v1/volumes?q={quote(query)}&maxResults=3"
    r = await client.get(url)
    data = r.json()
    items = data.get("items", [])
    if not items:
        return {}
    # Buscar el resultado con más datos (preferir el que tenga descripción)
    best = items[0]
    for item in items:
        if item.get("volumeInfo", {}).get("description"):
            best = item
            break
    info = best.get("volumeInfo", {})
    result = {}
    result["title"] = info.get("title", "")
    if info.get("authors"):
        result["author"] = info["authors"][0]
    if info.get("description"):
        result["synopsis"] = info["description"]
    if info.get("industryIdentifiers"):
        for ident in info["industryIdentifiers"]:
            if ident["type"] in ("ISBN_13", "ISBN_10"):
                result["isbn"] = ident["identifier"]
                break
    if info.get("publishedDate"):
        result["year"] = int(info["publishedDate"][:4]) if info["publishedDate"][:4].isdigit() else None
    if info.get("pageCount"):
        result["pages"] = info["pageCount"]
    if info.get("categories"):
        result["genre"] = info["categories"][0]
    if info.get("language"):
        result["language"] = info["language"]
    if info.get("imageLinks", {}).get("thumbnail"):
        result["cover_url"] = info["imageLinks"]["thumbnail"].replace("http://", "https://")
    return result


async def search_wikipedia_author(client: httpx.AsyncClient, author: str) -> dict:
    """Busca biografía del autor en Wikipedia (español primero, luego inglés)."""
    for lang in ("es", "en"):
        try:
            url = f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(author)}"
            r = await client.get(url, headers={"User-Agent": "BookTracker/1.0"})
            if r.status_code == 200:
                data = r.json()
                bio = data.get("extract", "")
                if bio and len(bio) > 50:
                    return {"author_bio": bio}
        except Exception:
            pass
    return {}


async def download_cover(url: str, file_path: str) -> Optional[str]:
    try:
        book_id = os.path.basename(file_path).rsplit(".", 1)[0]
        user_folder = os.path.basename(os.path.dirname(file_path))
        cover_dir = os.path.join(settings.COVERS_DIR, user_folder)
        os.makedirs(cover_dir, exist_ok=True)
        cover_path = os.path.join(cover_dir, f"{book_id}.jpg")

        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "BookTracker/1.0"})
            if r.status_code == 200:
                with open(cover_path, "wb") as f:
                    f.write(r.content)
                return cover_path
    except Exception as e:
        print(f"Cover download error: {e}")
    return None
