"""
Phase 2: Parse book structure - detect parts and chapters.
Supports PDF (via PyMuPDF TOC + heuristics) and EPUB (via ebooklib).
"""
import re
from typing import Optional
import fitz  # PyMuPDF


CHAPTER_PATTERNS = [
    r"^(cap[íi]tulo|chapter|capítulo)\s+(\d+|[ivxlcdm]+)[:\.\-\s]*(.*)",
    r"^(parte|part)\s+(\d+|[ivxlcdm]+)[:\.\-\s]*(.*)",
    r"^(\d+)[:\.\-\s]+(.+)$",
    r"^([IVXLCDM]+)[:\.\-\s]+(.+)$",
]

PART_PATTERNS = [
    r"^(parte|part|libro|book|sección|section)\s+(\d+|[ivxlcdm]+)[:\.\-\s]*(.*)",
]


async def parse_book_structure(file_path: str, file_type: str) -> dict:
    if file_type == "pdf":
        return await parse_pdf(file_path)
    elif file_type == "epub":
        return await parse_epub(file_path)
    return {"parts": [], "chapters": []}


async def parse_pdf(file_path: str) -> dict:
    doc = fitz.open(file_path)
    parts = []
    chapters = []

    # Try TOC first
    toc = doc.get_toc()
    if toc:
        current_part = None
        ch_order = 0
        for level, title, page in toc:
            title_clean = title.strip()
            if not title_clean:
                continue

            # Detect parts (level 1 with part-like names)
            is_part = any(re.match(p, title_clean, re.IGNORECASE) for p in PART_PATTERNS)

            if level == 1 and is_part:
                current_part = title_clean
                parts.append({"title": title_clean, "page": page})
            else:
                # Extract text for this chapter
                text = _extract_page_range(doc, page, _next_page(toc, toc.index([level, title, page]), doc.page_count))
                chapters.append({
                    "title": title_clean,
                    "part": current_part,
                    "page_start": page,
                    "page_end": _next_page(toc, toc.index([level, title, page]), doc.page_count),
                    "text": text,
                    "order": ch_order,
                })
                ch_order += 1
    else:
        # Heuristic: scan pages for chapter headings
        chapters = _heuristic_chapter_detection(doc)

    doc.close()
    return {"parts": parts, "chapters": chapters}


def _next_page(toc, idx, max_pages):
    if idx + 1 < len(toc):
        return toc[idx + 1][2] - 1
    return max_pages


def _extract_page_range(doc, start: int, end: int, max_chars: int = 40000) -> str:
    text_parts = []
    total = 0
    for page_num in range(max(0, start - 1), min(end, doc.page_count)):
        page_text = doc[page_num].get_text()
        text_parts.append(page_text)
        total += len(page_text)
        if total > max_chars:
            break
    return "\n".join(text_parts)[:max_chars]


def _heuristic_chapter_detection(doc) -> list:
    """Detect chapters by scanning for heading-like text on pages."""
    chapters = []
    current_chapter = None
    current_text = []
    order = 0

    for page_num in range(doc.page_count):
        page = doc[page_num]
        blocks = page.get_text("dict")["blocks"]

        for block in blocks:
            if block["type"] != 0:  # text block
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span["text"].strip()
                    size = span["size"]

                    if size >= 14 and len(text) > 2 and len(text) < 100:
                        for pattern in CHAPTER_PATTERNS:
                            if re.match(pattern, text, re.IGNORECASE):
                                # Save previous
                                if current_chapter:
                                    current_chapter["text"] = "\n".join(current_text)[:40000]
                                    chapters.append(current_chapter)

                                current_chapter = {
                                    "title": text,
                                    "part": None,
                                    "page_start": page_num + 1,
                                    "page_end": page_num + 1,
                                    "order": order,
                                }
                                current_text = []
                                order += 1
                                break

        if current_chapter:
            current_text.append(page.get_text())
            current_chapter["page_end"] = page_num + 1

    if current_chapter:
        current_chapter["text"] = "\n".join(current_text)[:40000]
        chapters.append(current_chapter)

    # Fallback: if no chapters found, treat whole book as one chunk
    if not chapters:
        full_text = ""
        for page_num in range(min(doc.page_count, 500)):
            full_text += doc[page_num].get_text()
            if len(full_text) > 100000:
                break
        chapters = [{"title": "Contenido completo", "part": None,
                     "page_start": 1, "page_end": doc.page_count,
                     "text": full_text[:80000], "order": 0}]

    return chapters


async def parse_epub(file_path: str) -> dict:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup

    book = epub.read_epub(file_path)
    chapters = []
    parts = []
    order = 0

    for item in book.get_items_of_type(ebooklib.ITEM_DOCUMENT):
        soup = BeautifulSoup(item.get_content(), "html.parser")
        title_tag = soup.find(["h1", "h2", "h3", "title"])
        title = title_tag.get_text(strip=True) if title_tag else item.get_name()

        # Remove headings from text
        for tag in soup(["h1", "h2", "h3", "nav", "script", "style"]):
            tag.decompose()

        text = soup.get_text(separator="\n", strip=True)
        if len(text) < 100:
            continue

        chapters.append({
            "title": title,
            "part": None,
            "page_start": None,
            "page_end": None,
            "text": text[:40000],
            "order": order,
        })
        order += 1

    return {"parts": parts, "chapters": chapters}
