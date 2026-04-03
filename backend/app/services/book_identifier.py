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


async def _fetch_wikipedia_extract(client: httpx.AsyncClient, lang: str, author_name: str) -> str:
    """Obtiene el extracto completo de intro de Wikipedia para un autor."""
    try:
        search_url = (
            f"https://{lang}.wikipedia.org/w/api.php"
            f"?action=query&list=search&srsearch={quote(author_name)}&format=json&srlimit=3"
        )
        r = await client.get(search_url)
        results = r.json().get("query", {}).get("search", [])
        if not results:
            return ""

        # Intentar los primeros 3 resultados — el primero puede no ser el autor
        name_parts = {p.lower() for p in author_name.split() if len(p) > 2}
        for hit in results:
            page_title = hit["title"]
            content_url = (
                f"https://{lang}.wikipedia.org/w/api.php"
                f"?action=query&titles={quote(page_title)}&prop=extracts"
                f"&exintro=false&explaintext=true&format=json"
            )
            r2 = await client.get(content_url)
            pages = r2.json().get("query", {}).get("pages", {})
            extract = next(iter(pages.values()), {}).get("extract", "").strip()
            if extract and any(p in extract.lower() for p in name_parts):
                return re.sub(r"\s+", " ", extract).strip()
        return ""
    except Exception as e:
        print(f"Wikipedia {lang} error for '{author_name}': {e}")
        return ""


async def get_author_bio_rich(author_name: str) -> str:
    """
    Genera una biografía completa y rica en español para un autor.
    Estrategia:
    1. Recopila texto crudo de Wikipedia ES y/o EN (sin límite de longitud)
    2. Pide a la IA que redacte una biografía extensa, fluida y en español,
       usando ese texto como fuente — nunca menor de 400 palabras.
    3. Si Wikipedia no tiene nada, la IA la genera desde su conocimiento.
    Devuelve string vacío si falla todo.
    """
    from app.services.ai_analyzer import _call_ai

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        # Recopilar fuentes — ES primero, EN como complemento
        es_extract = await _fetch_wikipedia_extract(client, "es", author_name)
        en_extract = await _fetch_wikipedia_extract(client, "en", author_name)

    # Construir contexto para la IA (hasta ~6000 chars entre las dos fuentes)
    sources = []
    if es_extract:
        sources.append(f"[Wikipedia ES]\n{es_extract[:3000]}")
    if en_extract:
        sources.append(f"[Wikipedia EN]\n{en_extract[:3000]}")
    source_text = "\n\n".join(sources)

    if source_text:
        system = (
            "Eres un biógrafo literario experto. Redactas biografías de autores en español "
            "de forma fluida, rica y bien estructurada, dirigidas a lectores interesados en literatura."
        )
        user = (
            f"Redacta una biografía completa en español de {author_name} usando como fuente "
            f"los siguientes textos de Wikipedia. La biografía debe:\n"
            f"- Estar íntegramente en español, con prosa natural y elegante\n"
            f"- Tener entre 400 y 600 palabras\n"
            f"- Cubrir: datos biográficos esenciales, formación y trayectoria, "
            f"obras más importantes, estilo literario, premios y reconocimientos, "
            f"curiosidades o datos relevantes\n"
            f"- No incluir secciones ni títulos — solo texto corrido\n"
            f"- No mencionar que proviene de Wikipedia\n\n"
            f"Fuentes:\n{source_text}"
        )
    else:
        # Sin fuentes — la IA genera desde su conocimiento
        print(f"Bio: sin fuentes Wikipedia para '{author_name}', generando desde conocimiento IA")
        system = (
            "Eres un biógrafo literario experto. Redactas biografías de autores en español "
            "de forma fluida, rica y bien estructurada."
        )
        user = (
            f"Redacta una biografía completa en español de {author_name}. La biografía debe:\n"
            f"- Estar íntegramente en español, con prosa natural y elegante\n"
            f"- Tener entre 400 y 600 palabras\n"
            f"- Cubrir: datos biográficos esenciales, formación y trayectoria, "
            f"obras más importantes, estilo literario, premios y reconocimientos, "
            f"curiosidades o datos relevantes\n"
            f"- No incluir secciones ni títulos — solo texto corrido\n"
            f"Si no conoces al autor, indica brevemente que no hay información disponible."
        )

    try:
        bio = await _call_ai(system, user, max_tokens=3000)
        if bio and len(bio) > 100:
            print(f"Bio generada para '{author_name}': {len(bio)} chars")
            return bio.strip()
    except Exception as e:
        print(f"Error generando bio para '{author_name}': {e}")

    return ""


# Alias para compatibilidad con llamadas existentes
async def get_author_bio_in_spanish(author_name: str) -> str:
    return await get_author_bio_rich(author_name)


async def search_wikipedia_author(client: httpx.AsyncClient, author_name: str) -> dict:
    """Wrapper para fase 1: obtiene bio rica en español."""
    bio = await get_author_bio_rich(author_name)
    return {"author_bio": bio} if bio else {}


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
    """Obtiene bibliografía del autor via Google Books con portadas y deduplicación.
    Prioriza ediciones en español y normaliza títulos al castellano publicado en España."""

    async def _fetch_books(lang_restrict: str) -> list:
        url = (
            f"https://www.googleapis.com/books/v1/volumes"
            f"?q=inauthor:{quote(author_name)}&maxResults=40&orderBy=newest"
        )
        if lang_restrict:
            url += f"&langRestrict={lang_restrict}"
        try:
            async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
                r = await c.get(url)
            if r.status_code != 200:
                return []
            return r.json().get("items", [])
        except Exception as e:
            print(f"Bibliography fetch error ({lang_restrict}): {e}")
            return []

    async def _spanish_title_for(title: str, author: str) -> str:
        """Usa la IA para obtener el título oficial en español publicado en España.
        Si el libro no tiene edición española, devuelve el título original."""
        from app.services.ai_analyzer import _call_ai
        result = await _call_ai(
            "Eres un experto en literatura y edición española. "
            "Responde ÚNICAMENTE con el título, sin explicaciones ni puntuación adicional.",
            f"¿Cuál es el título oficial en castellano (edición española) del libro '{title}' de {author}? "
            f"Si no existe edición en español, devuelve el título original tal cual.",
            max_tokens=60
        )
        if result:
            clean = result.strip().strip('"').strip("'")
            if len(clean) > 1:
                return clean
        return title

    def _extract_entry(item: dict) -> dict | None:
        info = item.get("volumeInfo", {})
        title = info.get("title", "").strip()
        authors = info.get("authors", [])
        if not title or not authors:
            return None
        if author_name.lower() not in " ".join(authors).lower():
            return None
        if _is_pack_or_collection(title):
            return None

        isbn = None
        for ident in info.get("industryIdentifiers", []):
            if ident.get("type") in ("ISBN_13", "ISBN_10"):
                isbn = ident.get("identifier")
                break

        year = None
        if info.get("publishedDate"):
            try:
                y = info["publishedDate"][:4]
                if y.isdigit():
                    year = int(y)
            except:
                pass

        cover_url = None
        if info.get("imageLinks"):
            links = info["imageLinks"]
            for key in ("large", "medium", "small", "thumbnail", "smallThumbnail"):
                if links.get(key):
                    cover_url = links[key].replace("http://", "https://")
                    if "zoom=1" in cover_url:
                        cover_url = cover_url.replace("zoom=1", "zoom=2")
                    break
        if not cover_url and isbn:
            cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg"

        synopsis = info.get("description", "")[:300] if info.get("description") else ""
        lang = info.get("language", "")

        return {
            "title": title,
            "isbn": isbn,
            "year": year,
            "cover_url": cover_url,
            "synopsis": synopsis,
            "lang": lang,
        }

    # 1. Obtener ediciones: primero en español, luego todas
    es_items = await _fetch_books("es")
    all_items = await _fetch_books("")

    seen_normalized: dict[str, dict] = {}

    def _merge(entry: dict):
        norm = _normalize_title(entry["title"])
        if norm not in seen_normalized:
            seen_normalized[norm] = entry
        else:
            ex = seen_normalized[norm]
            # Preferir edición en español
            if entry.get("lang") == "es" and ex.get("lang") != "es":
                seen_normalized[norm] = {**entry,
                    "cover_url": entry.get("cover_url") or ex.get("cover_url"),
                    "isbn": entry.get("isbn") or ex.get("isbn"),
                    "synopsis": entry.get("synopsis") or ex.get("synopsis"),
                }
                return
            # Completar campos vacíos
            if entry.get("cover_url") and not ex.get("cover_url"):
                ex["cover_url"] = entry["cover_url"]
            if entry.get("isbn") and not ex.get("isbn"):
                ex["isbn"] = entry["isbn"]
            if entry.get("synopsis") and not ex.get("synopsis"):
                ex["synopsis"] = entry["synopsis"]
            if entry.get("year") and ex.get("year") and entry["year"] < ex["year"]:
                ex["year"] = entry["year"]

    # Procesar primero los resultados en español (tienen prioridad)
    for item in es_items:
        entry = _extract_entry(item)
        if entry:
            _merge(entry)

    # Luego el resto (rellena huecos, no sobrescribe español)
    for item in all_items:
        entry = _extract_entry(item)
        if entry:
            _merge(entry)

    # 2. Normalizar títulos al castellano via IA para los que no están en español
    import asyncio as _asyncio
    entries = list(seen_normalized.values())

    async def _normalize_entry(entry: dict) -> dict:
        if entry.get("lang") == "es":
            return entry  # ya está en español
        spanish = await _spanish_title_for(entry["title"], author_name)
        entry["title"] = spanish
        return entry

    # Procesar en paralelo con límite de concurrencia
    semaphore = _asyncio.Semaphore(3)
    async def _limited(entry):
        async with semaphore:
            return await _normalize_entry(entry)

    normalized = await _asyncio.gather(*[_limited(e) for e in entries], return_exceptions=True)
    result = [e for e in normalized if isinstance(e, dict)]

    # Limpiar campo interno y ordenar por año desc
    for e in result:
        e.pop("lang", None)
    result.sort(key=lambda x: -(x.get("year") or 0))
    return result


def _bytes_to_jpeg(data: bytes) -> bytes:
    """Convierte cualquier formato de imagen soportado por Pillow a JPEG RGB.
    Soporta: JPEG, PNG, WebP, AVIF, BMP, TIFF, GIF, ICO, TGA, PPM, HEIC* y más.
    (*HEIC requiere pillow-heif instalado aparte)
    Devuelve los bytes JPEG resultantes, o los bytes originales si falla la conversión."""
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data))
        # Aplanar transparencia sobre fondo blanco (PNG, WebP con alpha, etc.)
        if img.mode in ("RGBA", "LA", "P"):
            background = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            background.paste(img, mask=img.split()[-1] if img.mode in ("RGBA", "LA") else None)
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=92, optimize=True)
        return out.getvalue()
    except Exception as e:
        print(f"Image conversion error: {e}")
        return data  # fallback: devolver original sin convertir


async def download_cover(cover_url: str, covers_dir: str, book_id: str) -> Optional[str]:
    """Descarga una imagen de cualquier formato y la guarda como JPEG."""
    try:
        os.makedirs(covers_dir, exist_ok=True)
        filename = f"{book_id}_cover.jpg"
        local_path = os.path.join(covers_dir, filename)

        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; BookTracker/2.0)",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        }
        async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
            r = await client.get(cover_url)
            if r.status_code == 200 and len(r.content) > 500:
                jpeg_data = _bytes_to_jpeg(r.content)
                with open(local_path, "wb") as f:
                    f.write(jpeg_data)
                return local_path
    except Exception as e:
        print(f"Cover download error: {e}")
    return None
