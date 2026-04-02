"""
Phase 1: Identify book and gather metadata.
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

        # Generar sinopsis con IA si no hay una buena
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


def _normalize_title(title: str) -> str:
    """Extrae el título principal quitando subtítulos de edición y variantes."""
    # Quitar contenido entre paréntesis: (Edición Limitada), (Limited Edition), etc.
    t = re.sub(r'\s*\([^)]*\)', '', title)
    # Quitar traducción bilingüe después de " / "
    t = t.split(' / ')[0]
    # Quitar número de serie: "Inspectora Elena Blanco N", "Libro N", etc.
    t = re.sub(r'\s*(Inspectora\s+\w+\s+\w+\s+\d+|Inspector[ao]\s+\w+\s+\d+)\s*$', '', t, flags=re.IGNORECASE)
    # Quitar subtítulos editoriales después de ":"
    t = re.sub(r'\s*:\s*(Inspectora|Pack|Estuche|Trilog|Tetral|Serie|Saga|Colec|Inspector).*', '', t, flags=re.IGNORECASE)
    return re.sub(r'\s+', ' ', t).strip().lower()


def _is_pack_or_collection(title: str) -> bool:
    """Detecta si un título es un pack, estuche o colección, no un libro individual."""
    patterns = [
        r'\bpack\b', r'\bestuche\b', r'\btrilog[íi]a\b', r'\btetralog[íi]a\b',
        r'\bsaga\b', r'\bcoleccion\b', r'\bcolecci[oó]n\b',
        r'\bomnibus\b', r'\bcomplet[ao]\b', r'\b\d+\s+libros\b',
        r'Premio\s+\w+\s+\d{4}\s*\(',   # "Premio Planeta 2021 (La Bestia + ...)"
        r'Estuche\s+con',
    ]
    return any(re.search(p, title, re.IGNORECASE) for p in patterns)


async def get_author_bibliography(author_name: str) -> list:
    """Obtiene bibliografía deduplicada del autor via Google Books."""
    url = f"https://www.googleapis.com/books/v1/volumes?q=inauthor:{quote(author_name)}&maxResults=40&orderBy=newest"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as c:
            r = await c.get(url)
        if r.status_code != 200:
            return []
        items = r.json().get("items", [])

        # Primera pasada: recopilar todos los candidatos
        candidates = []
        for item in items:
            info = item.get("volumeInfo", {})
            title = info.get("title", "").strip()
            authors = info.get("authors", [])
            if not title or not authors:
                continue
            if author_name.lower() not in " ".join(authors).lower():
                continue

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

            # Portada — probar varias resoluciones y mejorar zoom de thumbnails
            cover_url = None
            if info.get("imageLinks"):
                links = info["imageLinks"]
                for key in ("large", "medium", "small", "thumbnail", "smallThumbnail"):
                    if links.get(key):
                        cover_url = links[key].replace("http://", "https://")
                        # Subir resolución: zoom=1 → zoom=2
                        cover_url = re.sub(r'zoom=\d', 'zoom=2', cover_url)
                        break

            synopsis = info.get("description", "")

            candidates.append({
                "title":     title,
                "isbn":      isbn,
                "year":      year,
                "cover_url": cover_url,
                "synopsis":  synopsis[:500] if synopsis else None,
                "_norm":     _normalize_title(title),
                "_is_pack":  _is_pack_or_collection(title),
            })

        # Segunda pasada: deduplicar por título normalizado
        # Para cada grupo, conservar la mejor entrada
        groups = {}  # norm -> list of candidates
        for c in candidates:
            norm = c["_norm"]
            groups.setdefault(norm, []).append(c)

        results = []
        individual_count = sum(1 for c in candidates if not c["_is_pack"])

        for norm, group in groups.items():
            # Si hay individuales disponibles, descartar packs/colecciones
            is_pack_group = all(c["_is_pack"] for c in group)
            if is_pack_group and individual_count >= 2:
                continue

            # Dentro del grupo, elegir el mejor candidato:
            # 1) Preferir individuales sobre packs
            # 2) Preferir los que tienen portada
            # 3) Entre los que tienen portada, preferir el más antiguo (1ª edición)
            individuals = [c for c in group if not c["_is_pack"]]
            pool = individuals if individuals else group

            with_cover    = [c for c in pool if c["cover_url"]]
            without_cover = [c for c in pool if not c["cover_url"]]

            if with_cover:
                # El más antiguo con portada = primera edición disponible
                best = min(with_cover, key=lambda c: c.get("year") or 9999)
            else:
                # Sin portada: el más antiguo disponible
                best = min(without_cover, key=lambda c: c.get("year") or 9999)

            results.append({
                "title":    best["title"],
                "isbn":     best["isbn"],
                "year":     best["year"],
                "cover_url": best["cover_url"],
                "synopsis": best["synopsis"],
            })

        # Ordenar por año descendente (más reciente primero)
        results.sort(key=lambda x: x.get("year") or 0, reverse=True)

        print(f"Bibliography: {len(results)} titles for {author_name} ({len(items)} raw, {len(candidates)} candidates)")
        return results

    except Exception as e:
        print(f"Google Books bibliography error: {e}")
        return []


async def search_google_books(client: httpx.AsyncClient, query: str) -> dict:
    url = f"https://www.googleapis.com/books/v1/volumes?q={quote(query)}&maxResults=3"
    r = await client.get(url)
    data = r.json()
    items = data.get("items", [])
    if not items:
        return {}
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
        cover = info["imageLinks"]["thumbnail"].replace("http://", "https://")
        result["cover_url"] = re.sub(r'zoom=\d', 'zoom=2', cover)
    return result


async def search_wikipedia_author(client: httpx.AsyncClient, author: str) -> dict:
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
