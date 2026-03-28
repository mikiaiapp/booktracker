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

            # Open Library author works (bibliography)
            if not metadata.get("author_bibliography") and metadata.get("_ol_author_key"):
                try:
                    biblio = await get_ol_author_works(client, metadata["_ol_author_key"])
                    if biblio:
                        metadata["author_bibliography"] = biblio
                except Exception as e:
                    print(f"OL bibliography error: {e}")

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
    if doc.get("first_sentence"):
        result["synopsis"] = doc["first_sentence"].get("value", "")
    # Guardar author_key para obtener bibliografía después
    if doc.get("author_key"):
        result["_ol_author_key"] = doc["author_key"][0]
    return result


async def get_ol_author_works(client: httpx.AsyncClient, author_key: str) -> list:
    """Obtiene la bibliografía completa del autor desde Open Library."""
    url = f"https://openlibrary.org{author_key}/works.json?limit=20"
    r = await client.get(url)
    if r.status_code != 200:
        return []
    data = r.json()
    works = data.get("entries", [])
    titles = [w.get("title") for w in works if w.get("title")]
    return titles[:15]


async def search_google_books(client: httpx.AsyncClient, query: str) -> dict:
    url = f"https://www.googleapis.com/books/v1/volumes?q={quote(query)}&maxResults=1"
    r = await client.get(url)
    data = r.json()
    items = data.get("items", [])
    if not items:
        return {}
    info = items[0].get("volumeInfo", {})
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
