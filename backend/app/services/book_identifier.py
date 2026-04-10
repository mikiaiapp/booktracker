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


async def identify_book(file_path: str, file_type: str, fallback_title: str, covers_dir: Optional[str] = None, book_id: Optional[str] = None, api_keys: dict = None) -> dict:
    hints = await extract_file_hints(file_path, file_type)
    title = hints.get("title") or fallback_title
    author = hints.get("author")
    metadata = await search_book_metadata(title, author, api_keys=api_keys)
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


async def search_book_metadata(title: str, author: Optional[str] = None, api_keys: dict = None) -> dict:
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
                synopsis = await _call_ai(system, user, max_tokens=800, api_keys=api_keys)
                if synopsis and len(synopsis) > 150:
                    metadata["synopsis"] = synopsis.strip()
                    print(f"AI synopsis generated: {len(synopsis)} chars")
            except Exception as e:
                print(f"AI synopsis error: {e}")

        author_name = metadata.get("author") or author
        if author_name:
            if not metadata.get("author_bio"):
                try:
                    bio_data = await search_wikipedia_author(client, author_name, api_keys=api_keys)
                    if bio_data:
                        metadata.update(bio_data)
                except Exception as e:
                    print(f"Wikipedia error: {e}")

            author_name = metadata.get("author") or author
            if author_name:
                try:
                    biblio = await get_author_bibliography(author_name, api_keys=api_keys)
                    if biblio:
                        metadata["author_bibliography"] = biblio
                except Exception as e:
                    print(f"Bibliography error: {e}")

        metadata.pop("_ol_author_key", None)

    return metadata


async def _get_google_books_cover(client, title, author, isbn=None):
    """Obtener portada de Google Books en buena resolución, priorizando edición española."""
    try:
        queries = []
        if isbn:
            queries.append(f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}&maxResults=5&langRestrict=es&country=ES")
            queries.append(f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn}&maxResults=5")
        else:
            q = quote(f"{title} {author}".strip())
            queries.append(f"https://www.googleapis.com/books/v1/volumes?q={q}&maxResults=5&langRestrict=es&country=ES")
            queries.append(f"https://www.googleapis.com/books/v1/volumes?q={q}&maxResults=5")

        for url in queries:
            r = await client.get(url)
            items = r.json().get("items", [])
            if not items:
                continue
            # Preferir resultado con idioma español
            def score(item):
                info = item.get("volumeInfo", {})
                return (info.get("language") == "es") * 2 + bool(info.get("imageLinks"))
            best = max(items, key=score)
            links = best.get("volumeInfo", {}).get("imageLinks", {})
            for key in ("extraLarge", "large", "medium", "small", "thumbnail", "smallThumbnail"):
                if links.get(key):
                    cover = links[key].replace("http://", "https://")
                    # zoom=1 siempre disponible; zoom>1 suele dar 404
                    cover = cover.replace("zoom=2", "zoom=1").replace("zoom=3", "zoom=1")
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
                    cover = cover.replace("zoom=2", "zoom=1").replace("zoom=3", "zoom=1")
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


async def get_author_bio_rich(author_name: str, api_keys: dict = None) -> str:
    """
    Genera una biografía completa y rica en español para un autor.
    Estrategia:
    1. Recopila texto crudo de Wikipedia ES y/o EN (sin límite de longitud )
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
        bio = await _call_ai(system, user, max_tokens=3000, api_keys=api_keys)
        if bio and len(bio) > 100:
            print(f"Bio generada para '{author_name}': {len(bio)} chars")
            return bio.strip()
    except Exception as e:
        print(f"Error generando bio para '{author_name}': {e}")

    return ""


# Alias para compatibilidad con llamadas existentes
async def get_author_bio_in_spanish(author_name: str, api_keys: dict = None) -> str:
    return await get_author_bio_rich(author_name, api_keys=api_keys)


async def search_wikipedia_author(client: httpx.AsyncClient, author_name: str, api_keys: dict = None) -> dict:
    """Wrapper para fase 1: obtiene bio rica en español."""
    bio = await get_author_bio_rich(author_name, api_keys=api_keys)
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


async def get_author_bibliography(author_name: str, api_keys: dict = None) -> list:
    """
    Obtiene bibliografía completa del autor combinando:
      - Google Books (paginado hasta 200 resultados, ES + sin filtro)
      - Open Library (obras del autor, cobertura superior para autores españoles)
    Deduplica por ISBN y por título normalizado, prioriza ediciones en español,
    y normaliza títulos al castellano via IA para los que no lo están.
    """
    import asyncio as _asyncio

    # ── Helpers internos ──────────────────────────────────────────────────────

    async def _fetch_gb_page(session: httpx.AsyncClient, lang: str, start_index: int) -> list:
        """Una página de Google Books (max 40 por llamada)."""
        url = (
            f"https://www.googleapis.com/books/v1/volumes"
            f"?q=inauthor:{quote(author_name)}&maxResults=40&startIndex={start_index}"
        )
        if lang:
            url += f"&langRestrict={lang}"
        try:
            r = await session.get(url)
            if r.status_code != 200:
                return []
            data = r.json()
            return data.get("items", [])
        except Exception as e:
            print(f"GB fetch error (lang={lang!r}, start={start_index}): {e}")
            return []

    async def _fetch_gb_all(lang: str) -> list:
        """Pagina Google Books hasta agotar resultados (máx ~200)."""
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as session:
            items = []
            for start in range(0, 201, 40):
                page = await _fetch_gb_page(session, lang, start)
                if not page:
                    break
                items.extend(page)
                if len(page) < 40:
                    break  # última página
                await _asyncio.sleep(0.3)  # respetar rate limit
        return items

    async def _fetch_ol() -> list:
        """
        Open Library: busca el autor y recorre sus obras.
        Devuelve lista de dicts con {title, isbn, year, cover_url, lang}.
        """
        results = []
        try:
            async with httpx.AsyncClient(timeout=25, follow_redirects=True) as session:
                # 1. Encontrar el author_key de OL
                r = await session.get(
                    f"https://openlibrary.org/search/authors.json?q={quote(author_name)}&limit=3"
                )
                docs = r.json().get("docs", [])
                if not docs:
                    return []

                # Elegir el que más coincide con el nombre
                name_parts = {w.lower() for w in author_name.split() if len(w) > 2}
                best = None
                for doc in docs:
                    n = doc.get("name", "")
                    parts = {w.lower() for w in n.split() if len(w) > 2}
                    if len(name_parts & parts) >= min(2, len(name_parts)):
                        best = doc
                        break
                if not best:
                    best = docs[0]

                author_key = best.get("key", "")
                if not author_key:
                    return []

                # 2. Obtener obras del autor (paginado en bloques de 50)
                all_works = []
                for offset in range(0, 501, 50):
                    r2 = await session.get(
                        f"https://openlibrary.org/authors/{author_key}/works.json"
                        f"?limit=50&offset={offset}"
                    )
                    if r2.status_code != 200:
                        break
                    data = r2.json()
                    entries = data.get("entries", [])
                    if not entries:
                        break
                    all_works.extend(entries)
                    if len(entries) < 50:
                        break
                    await _asyncio.sleep(0.3)

                print(f"OL: {len(all_works)} obras para '{author_name}'")

                # 3. Para cada obra, extraer título, año y cover
                for work in all_works:
                    title = work.get("title", "").strip()
                    if not title or _is_pack_or_collection(title):
                        continue

                    year = None
                    if work.get("first_publish_date"):
                        try:
                            y = str(work["first_publish_date"])[:4]
                            if y.isdigit():
                                year = int(y)
                        except:
                            pass

                    cover_url = None
                    covers = work.get("covers", [])
                    if covers and covers[0] > 0:
                        cover_url = f"https://covers.openlibrary.org/b/id/{covers[0]}-L.jpg"

                    # ISBN: buscar en la primera edición disponible
                    isbn = None
                    work_key = work.get("key", "")
                    if work_key:
                        try:
                            r3 = await session.get(
                                f"https://openlibrary.org{work_key}/editions.json?limit=10"
                            )
                            if r3.status_code == 200:
                                editions = r3.json().get("entries", [])
                                # Preferir edición española
                                es_editions = [e for e in editions if e.get("languages") and
                                               any("spa" in str(l) for l in e.get("languages", []))]
                                target_editions = es_editions or editions
                                for ed in target_editions:
                                    ids = ed.get("isbn_13") or ed.get("isbn_10") or []
                                    if ids:
                                        isbn = ids[0]
                                        break
                                    # cover desde edición si no tenemos
                                    if not cover_url:
                                        ec = ed.get("covers", [])
                                        if ec and ec[0] > 0:
                                            cover_url = f"https://covers.openlibrary.org/b/id/{ec[0]}-L.jpg"
                        except Exception:
                            pass

                    results.append({
                        "title": title,
                        "isbn": isbn,
                        "year": year,
                        "cover_url": cover_url,
                        "synopsis": "",
                        "lang": "es" if any(
                            w in title.lower() for w in ["el ", "la ", "los ", "las ", "un ", "una "]
                        ) else "",
                    })
        except Exception as e:
            print(f"OL bibliography error for '{author_name}': {e}")
        return results

    def _extract_gb_entry(item: dict) -> dict | None:
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
                    cover_url = cover_url.replace("zoom=2", "zoom=1").replace("zoom=3", "zoom=1")
                    break
        if not cover_url and isbn:
            cover_url = f"https://covers.openlibrary.org/b/isbn/{isbn}-M.jpg"

        synopsis = info.get("description", "")[:400] if info.get("description") else ""
        lang = info.get("language", "")

        return {"title": title, "isbn": isbn, "year": year,
                "cover_url": cover_url, "synopsis": synopsis, "lang": lang}

    async def _spanish_title_for(title: str, author: str):
        from app.services.ai_analyzer import _call_ai
        # Prompt más agresivo para normalizar a la versión canónica en español
        result = await _call_ai(
            "Eres un experto en literatura y edición española. "
            "Responde ÚNICAMENTE con el título oficial en castellano (edición España), sin explicaciones ni puntuación adicional.",
            f"¿Cuál es el título canónico en castellano del libro '{title}' de {author}? "
            "Si es una traducción, devuelve el título de la edición española más conocida. "
            "Si no tiene traducción, devuelve el original.",
            max_tokens=60,
            api_keys=api_keys
        )
        if result:
            clean = result.strip().strip('"').strip("'")
            if len(clean) > 1:
                return clean
        return title

    async def _ensure_synopsis(entry, author):
        """Si falta sinopsis, genera una breve con IA."""
        if entry.get("synopsis") and len(entry["synopsis"]) > 80:
            return entry
        from app.services.ai_analyzer import _call_ai
        res = await _call_ai(
            "Eres un bibliotecario experto. Escribe en español.",
            f"Escribe una sinopsis muy breve (2 frases, max 50 palabras) del libro '{entry['title']}' de {author}.",
            max_tokens=150,
            api_keys=api_keys
        )
        if res:
            entry["synopsis"] = res.strip()
        return entry

    # ── Recopilación en paralelo ──────────────────────────────────────────────
    gb_es_items, gb_all_items, ol_entries = await _asyncio.gather(
        _fetch_gb_all("es"),
        _fetch_gb_all(""),
        _fetch_ol(),
    )

    # ── Deduplicación ─────────────────────────────────────────────────────────
    # Dos índices: por ISBN (exacto) y por título normalizado
    seen_isbn: dict[str, str] = {}        # isbn -> norm_title (para detectar colisiones)
    seen_norm: dict[str, dict] = {}       # norm_title -> entry

    def _merge(entry: dict):
        norm = _normalize_title(entry["title"])
        isbn = entry.get("isbn")

        # Si el ISBN ya existe, apuntar al mismo norm_title
        if isbn and isbn in seen_isbn:
            norm = seen_isbn[isbn]
        elif isbn:
            seen_isbn[isbn] = norm

        if norm not in seen_norm:
            seen_norm[norm] = dict(entry)
            if isbn:
                seen_isbn[isbn] = norm
        else:
            ex = seen_norm[norm]
            # Actualizar ISBN cruzado si faltaba
            if isbn and not ex.get("isbn"):
                ex["isbn"] = isbn
                seen_isbn[isbn] = norm
            # Preferir edición en español
            if entry.get("lang") == "es" and ex.get("lang") != "es":
                seen_norm[norm] = {**entry,
                    "cover_url": entry.get("cover_url") or ex.get("cover_url"),
                    "isbn": ex.get("isbn") or entry.get("isbn"),
                    "synopsis": entry.get("synopsis") or ex.get("synopsis"),
                }
                return
            # Completar huecos
            if entry.get("cover_url") and not ex.get("cover_url"):
                ex["cover_url"] = entry["cover_url"]
            if entry.get("synopsis") and not ex.get("synopsis"):
                ex["synopsis"] = entry["synopsis"]
            # Año más antiguo = primera publicación
            if entry.get("year") and (not ex.get("year") or entry["year"] < ex["year"]):
                ex["year"] = entry["year"]

    # Orden de prioridad: GB español > GB global > OL
    for item in gb_es_items:
        entry = _extract_gb_entry(item)
        if entry:
            _merge(entry)
    for item in gb_all_items:
        entry = _extract_gb_entry(item)
        if entry:
            _merge(entry)
    for entry in ol_entries:
        _merge(entry)

    print(f"Bibliografía '{author_name}': {len(seen_norm)} títulos únicos "
          f"(GB_es={len(gb_es_items)}, GB_all={len(gb_all_items)}, OL={len(ol_entries)})")

    # ── Normalizar títulos al castellano y asegurar sinopsis via IA ──────────
    entries = list(seen_norm.values())

    semaphore = _asyncio.Semaphore(6)
    async def _process_entry(entry):
        async with semaphore:
            # 1. Normalizar título si no es español o si queremos asegurar versión canónica
            if entry.get("lang") != "es":
                entry["title"] = await _spanish_title_for(entry["title"], author_name)
            
            # 2. Asegurar sinopsis ficha básica
            await _ensure_synopsis(entry, author_name)
            return entry

    processed = await _asyncio.gather(*[_process_entry(e) for e in entries],
                                       return_exceptions=True)
    result = [e for e in processed if isinstance(e, dict)]

    # Limpiar campo interno y ordenar por año desc (más moderno primero)
    for e in result:
        e.pop("lang", None)
    
    # Ordenar: nulos al final, el resto DESC
    result.sort(key=lambda x: (x.get("year") is None, -(x.get("year") or 0)))
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
    """Descarga una imagen de cualquier formato y la guarda como JPEG.
    Intenta con distintos User-Agent y sin Referer para maximizar compatibilidad."""
    import time
    os.makedirs(covers_dir, exist_ok=True)
    filename = f"{book_id}_cover_{int(time.time())}.jpg"
    local_path = os.path.join(covers_dir, filename)

    # Distintas configuraciones de headers para sortear restricciones de servidor
    header_variants = [
        {   # Navegador estándar
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                          "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
        {   # Bot neutro
            "User-Agent": "BookTracker/2.0 (+https://booktracker.app)",
            "Accept": "image/*,*/*;q=0.8",
        },
        {   # Sin headers especiales
        },
    ]

    for headers in header_variants:
        try:
            async with httpx.AsyncClient(timeout=30, follow_redirects=True, headers=headers) as client:
                r = await client.get(cover_url)
            if r.status_code == 200 and len(r.content) > 500:
                jpeg_data = _bytes_to_jpeg(r.content)
                if len(jpeg_data) > 500:
                    with open(local_path, "wb") as f:
                        f.write(jpeg_data)
                    print(f"Cover descargada: {cover_url[:60]}… → {local_path}")
                    return local_path
            elif r.status_code in (403, 401, 429):
                print(f"Cover HTTP {r.status_code} con headers={list(headers.keys())}, reintentando…")
                continue
        except Exception as e:
            print(f"Cover download error ({cover_url[:60]}…): {e}")
            continue

    print(f"Cover no descargable tras {len(header_variants)} intentos: {cover_url[:80]}")
    return None
