"""
Phase 1: Identify book and gather metadata.
1. Extract hints from the file (title, author from metadata)
2. Search Open Library + Google Books for book data
3. Search Wikipedia for author bio
4. Download cover image
5. Get author bibliography with covers via Google Books
"""
import httpx
import re
import os
from urllib.parse import quote
from typing import Optional
import fitz  # PyMuPDF
from app.core.config import settings


async def identify_book(file_path: str, file_type: str, fallback_title: str, covers_dir: Optional[str] = None, book_id: Optional[str] = None) -> dict:
    hints = await extract_file_hints(file_path, file_type)
    title = hints.get("title") or fallback_title
    author = hints.get("author")
    metadata = await search_book_metadata(title, author)
    if metadata.get("cover_url") and covers_dir and book_id:
        local_cover = await download_cover(metadata["cover_url"], covers_dir, book_id)
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
        try:
            ol_data = await search_open_library(client, query)
            if ol_data:
                metadata.update(ol_data)
        except Exception as e:
            print(f"Open Library error: {e}")

        try:
            gb_data = await search_google_books(client, query)
            if gb_data:
                for k, v in gb_data.items():
                    if not metadata.get(k):
                        metadata[k] = v
        except Exception as e:
            print(f"Google Books error: {e}")

        # Mejorar portada con Google Books zoom=2 si solo tenemos Open Library
        if metadata.get("cover_url") and "covers.openlibrary.org" in metadata["cover_url"]:
            # Intentar obtener portada de Google Books con mejor resolución
            try:
                isbn = metadata.get("isbn")
                title_q = metadata.get("title", title)
                author_q = metadata.get("author", author or "")
                gb_cover = await _get_google_books_cover(client, title_q, author_q, isbn)
                if gb_cover:
                    metadata["cover_url"] = gb_cover
            except Exception as e:
                print(f"GB cover upgrade error: {e}")

        # Generate AI synopsis if missing or too short
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

        author_name = metadata.get("author") or author
        if author_name:
            if not metadata.get("author_bio"):
                try:
                    bio_data = await search_wikipedia_author(client, author_name)
                    if bio_data:
                        metadata.update(bio_data)
                except Exception as e:
                    print(f"Wikipedia error: {e}")

            author_name = metadata.get("author") or author
            if author_name:
                try:
                    biblio = await get_author_bibliography(author_name)
                    if biblio:
                        metadata["author_bibliography"] = biblio
                except Exception as e:
                    print(f"Bibliography error: {e}")

        metadata.pop("_ol_author_key", None)

    return metadata


async def _get_google_books_cover(client, title, author, isbn=None):
    """Obtener portada de Google Books en buena resolución."""
    try:
        if isbn:
            url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}&maxResults=1"
        else:
            q = quote(f"{title} {author}".strip())
            url = f"https://www.googleapis.com/books/v1/volumes?q={q}&maxResults=1"
        r = await client.get(url)
        items = r.json().get("items", [])
        if not items:
            return None
        links = items[0].get("volumeInfo", {}).get("imageLinks", {})
        for key in ("large", "medium", "small", "thumbnail", "smallThumbnail"):
            if links.get(key):
                cover = links[key].replace("http://", "https://")
                if "zoom=1" in cover:
                    cover = cover.replace("zoom=1", "zoom=2")
                return cover
    except Exception:
        pass
    return None


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
    if doc.get("author_key"):
        result["_ol_author_key"] = doc["author_key"][0]
    return result


async def search_google_books(client: httpx.AsyncClient, query: str) -> dict:
    # Intentar primero restringido a español, luego sin restricción
    for lang_restrict in ("es", ""):
        url = f"https://www.googleapis.com/books/v1/volumes?q={quote(query)}&maxResults=5"
        if lang_restrict:
            url += f"&langRestrict={lang_restrict}"
        try:
            r = await client.get(url)
            data = r.json()
        except Exception:
            continue
        items = data.get("items", [])
        if not items:
            continue

        # Escoger el mejor resultado: preferir idioma español
        def score(item):
            info = item.get("volumeInfo", {})
            lang = info.get("language", "")
            has_cover = bool(info.get("imageLinks"))
            has_isbn = any(i.get("type") in ("ISBN_13","ISBN_10") for i in info.get("industryIdentifiers",[]))
            return (lang == "es") * 4 + has_cover * 2 + has_isbn * 1

        best = max(items, key=score)
        info = best.get("volumeInfo", {})

        result = {}
        result["title"] = info.get("title", "")
        if info.get("authors"):
            result["author"] = info["authors"][0]
        ids = info.get("industryIdentifiers", [])
        for ident in ids:
            if ident.get("type") in ("ISBN_13", "ISBN_10"):
                result["isbn"] = ident.get("identifier")
                break
        if info.get("publishedDate"):
            try:
                y = info["publishedDate"][:4]
                if y.isdigit():
                    result["year"] = int(y)
            except:
                pass
        if info.get("pageCount"):
            result["pages"] = info["pageCount"]
        if info.get("categories"):
            result["genre"] = info["categories"][0]
        if info.get("language"):
            result["language"] = info["language"]
        if info.get("description"):
            result["synopsis"] = info["description"]
        if info.get("imageLinks"):
            links = info["imageLinks"]
            for key in ("large", "medium", "small", "thumbnail", "smallThumbnail"):
                if links.get(key):
                    cover = links[key].replace("http://", "https://")
                    if "zoom=1" in cover:
                        cover = cover.replace("zoom=1", "zoom=2")
                    result["cover_url"] = cover
                    break
        return result
    return {}


async def search_wikipedia_author(client: httpx.AsyncClient, author_name: str) -> dict:
    """Busca bio del autor: primero Wikipedia ES, luego EN con traducción IA, luego Open Library."""

    async def _fetch_wikipedia(lang: str, name: str) -> str:
        try:
            search_url = (
                f"https://{lang}.wikipedia.org/w/api.php"
                f"?action=query&list=search&srsearch={quote(name)}&format=json&srlimit=1"
            )
            r = await client.get(search_url)
            results = r.json().get("query", {}).get("search", [])
            if not results:
                return ""
            page_title = results[0]["title"]
            content_url = (
                f"https://{lang}.wikipedia.org/w/api.php"
                f"?action=query&titles={quote(page_title)}&prop=extracts&exintro=true"
                f"&explaintext=true&format=json"
            )
            r2 = await client.get(content_url)
            pages = r2.json().get("query", {}).get("pages", {})
            page = next(iter(pages.values()), {})
            extract = page.get("extract", "").strip()
            if not extract:
                return ""
            # Verificar que el resultado es sobre el autor
            name_parts = {p.lower() for p in name.split() if len(p) > 2}
            if not any(p in extract.lower() for p in name_parts):
                return ""
            clean = re.sub(r"\s+", " ", extract).strip()
            return clean[:1000]
        except Exception as e:
            print(f"Wikipedia {lang} error for '{name}': {e}")
            return ""

    async def _fetch_openlibrary(name: str) -> str:
        try:
            url = f"https://openlibrary.org/search/authors.json?q={quote(name)}&limit=1"
            r = await client.get(url)
            docs = r.json().get("docs", [])
            if not docs:
                return ""
            author_key = docs[0].get("key", "")
            if not author_key:
                return ""
            r2 = await client.get(f"https://openlibrary.org{author_key}.json")
            data = r2.json()
            bio = data.get("bio", "")
            if isinstance(bio, dict):
                bio = bio.get("value", "")
            return str(bio).strip()[:800] if bio else ""
        except Exception as e:
            print(f"OpenLibrary bio error for '{name}': {e}")
            return ""

    def _is_english(text: str) -> bool:
        """Heurística rápida: si hay muchas palabras inglesas comunes, está en inglés."""
        english_markers = ['the ', ' is ', ' are ', ' was ', ' were ', ' has ', ' have ',
                           ' of ', ' and ', ' in ', ' to ', ' a ', ' an ', ' for ',
                           'known as', 'born in', 'she is', 'he is', 'they are']
        text_lower = text.lower()
        hits = sum(1 for m in english_markers if m in text_lower)
        return hits >= 4

    async def _translate_to_spanish(bio: str) -> str:
        """Traduce un texto al español usando la IA configurada."""
        try:
            from app.services.ai_analyzer import _call_ai
            translated = await _call_ai(
                "Eres un traductor experto literario. Traduce el siguiente texto al español de forma natural y fluida.",
                f"Traduce al español:\n\n{bio}",
                max_tokens=700
            )
            if translated and len(translated) > 80:
                return translated.strip()
        except Exception as e:
            print(f"Translation error: {e}")
        return bio  # devolver original si falla

    # 1. Wikipedia en español
    bio = await _fetch_wikipedia("es", author_name)
    if bio:
        # Verificar que realmente está en español
        if _is_english(bio):
            bio = await _translate_to_spanish(bio)
        return {"author_bio": bio}

    # 2. Wikipedia en inglés + traducción
    bio = await _fetch_wikipedia("en", author_name)
    if bio:
        bio = await _translate_to_spanish(bio)
        return {"author_bio": bio}

    # 3. Open Library como último recurso
    bio = await _fetch_openlibrary(author_name)
    if bio:
        if _is_english(bio):
            bio = await _translate_to_spanish(bio)
        return {"author_bio": bio}

    return {}


def _normalize_title(title: str) -> str:
    """Extrae el título principal descartando subtítulos de edición."""
    t = re.sub(r'\s*\([^)]*\)', '', title)
    t = t.split(' / ')[0]
    t = re.sub(r'\s*:\s*(Inspectora|Pack|Estuche|Trilog|Tetral|Serie|Saga|Colec).*', '', t, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', t).strip().lower()


def _is_pack_or_collection(title: str) -> bool:
    """Detecta packs, estuches y colecciones que no son libros individuales."""
    patterns = [
        r'\bpack\b', r'\bestuche\b', r'\btrilog[íi]a\b', r'\btetralog[íi]a\b',
        r'\bsaga\b', r'\bcoleccion\b', r'\bcolecci[oó]n\b', r'\bserie\b',
        r'\bomnibus\b', r'\bcomplet[ao]\b', r'\b\d+ libros\b',
        r'Premio Planeta \d{4}',
        r'\w+\s+\d{4}\s*\(',
        r'Estuche\s+con',
    ]
    return any(re.search(p, title, re.IGNORECASE) for p in patterns)


async def get_author_bibliography(author_name: str) -> list:
    """Obtiene bibliografía del autor via Google Books con portadas y deduplicación."""
    url = f"https://www.googleapis.com/books/v1/volumes?q=inauthor:{quote(author_name)}&maxResults=40&orderBy=newest"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
            r = await c.get(url)
        if r.status_code != 200:
            return []
        items = r.json().get("items", [])

        seen_normalized = {}  # normalized_title -> best_entry

        for item in items:
            info = item.get("volumeInfo", {})
            title = info.get("title", "").strip()
            authors = info.get("authors", [])
            if not title or not authors:
                continue
            # Solo libros donde el autor es el principal
            if author_name.lower() not in " ".join(authors).lower():
                continue
            # Filtrar packs y colecciones
            if _is_pack_or_collection(title):
                continue

            # Extraer ISBN
            isbn = None
            for ident in info.get("industryIdentifiers", []):
                if ident.get("type") in ("ISBN_13", "ISBN_10"):
                    isbn = ident.get("identifier")
                    break

            # Extraer año
            year = None
            if info.get("publishedDate"):
                try:
                    y = info["publishedDate"][:4]
                    if y.isdigit():
                        year = int(y)
                except:
                    pass

            # Extraer portada — mejor resolución disponible
            cover_url = None
            if info.get("imageLinks"):
                links = info["imageLinks"]
                for key in ("large", "medium", "small", "thumbnail", "smallThumbnail"):
                    if links.get(key):
                        cover_url = links[key].replace("http://", "https://")
                        if "zoom=1" in cover_url:
                            cover_url = cover_url.replace("zoom=1", "zoom=2")
                        break

            # Fallback a Open Library si no hay portada de Google Books
            if not cover_url and isbn:
                cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg"

            synopsis = info.get("description", "")[:300] if info.get("description") else ""

            norm = _normalize_title(title)

            if norm not in seen_normalized:
                seen_normalized[norm] = {
                    "title": title,
                    "isbn": isbn,
                    "year": year,
                    "cover_url": cover_url,
                    "synopsis": synopsis,
                }
            else:
                # Mantener la entrada con más información (preferir la que tiene portada)
                existing = seen_normalized[norm]
                if cover_url and not existing.get("cover_url"):
                    existing["cover_url"] = cover_url
                if isbn and not existing.get("isbn"):
                    existing["isbn"] = isbn
                if year and not existing.get("year"):
                    existing["year"] = year
                if synopsis and not existing.get("synopsis"):
                    existing["synopsis"] = synopsis
                # Preferir el año más antiguo (primera publicación)
                if year and existing.get("year") and year < existing["year"]:
                    existing["year"] = year

        result = list(seen_normalized.values())
        result.sort(key=lambda x: -(x.get("year") or 0))
        return result

    except Exception as e:
        print(f"Bibliography error: {e}")
        return []


async def download_cover(cover_url: str, covers_dir: str, book_id: str) -> Optional[str]:
    """Download cover image and save locally as {book_id}_cover.jpg"""
    try:
        os.makedirs(covers_dir, exist_ok=True)
        filename = f"{book_id}_cover.jpg"
        local_path = os.path.join(covers_dir, filename)

        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            r = await client.get(cover_url)
            if r.status_code == 200 and len(r.content) > 1000:
                with open(local_path, "wb") as f:
                    f.write(r.content)
                return local_path
    except Exception as e:
        print(f"Cover download error: {e}")
    return None
