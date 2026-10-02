import os
import re
import hashlib
import logging
import asyncio
from pathlib import Path
from typing import AsyncGenerator

import db
from embeddings import embed, to_blob

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {
    ".txt", ".md", ".pdf",
    ".docx", ".doc", ".xlsx", ".pptx", ".ppt",
    ".html",
    ".mp3", ".wav", ".m4a", ".mp4"
}

AUDIO_VIDEO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4"}

# Chunk 800 chars with 150-char overlap — semantic sentence boundary preferred
CHUNK_SIZE    = 800
CHUNK_OVERLAP = 150


# ── Text chunking ──────────────────────────────────────────────────────────

def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[dict]:
    """
    Split text into overlapping chunks. Tries to break at sentence boundaries
    within a tolerance window to avoid cutting mid-sentence.
    """
    text = re.sub(r"[ \t\r\f\v]+", " ", text).strip()
    chunks = []
    i = 0
    while i < len(text):
        end = min(i + size, len(text))
        # Try to snap end to a sentence boundary within last 15% of chunk
        if end < len(text):
            snap_start = end - int(size * 0.15)
            boundary   = _find_sentence_boundary(text, snap_start, end)
            if boundary:
                end = boundary
        content = text[i:end].strip()
        if content:
            chunks.append({"content": content, "start": i, "end": end})
        i = end - overlap
        if i >= len(text) or end == len(text):
            break
    return chunks


def _find_sentence_boundary(text: str, start: int, end: int) -> int | None:
    """Find the last sentence-ending punctuation in [start, end]."""
    for j in range(end - 1, start - 1, -1):
        if text[j] in ".!?\n" and (j + 1 >= len(text) or text[j + 1] in " \n\t"):
            return j + 1
    return None


# ── File text extraction ───────────────────────────────────────────────────

async def extract_text(path: str, mime_type: str, source_id: str | None = None) -> str:
    ext = Path(path).suffix.lower()

    if ext in (".txt", ".md"):
        return Path(path).read_text(encoding="utf-8", errors="replace")

    if ext == ".pdf":
        return await asyncio.to_thread(_extract_pdf, path)

    if ext in (".docx", ".xlsx", ".pptx", ".ppt"):
        return await asyncio.to_thread(_extract_office, path, ext)

    if ext == ".html":
        return await asyncio.to_thread(_extract_html, path)

    if ext in AUDIO_VIDEO_EXTENSIONS:
        from transcribe import transcribe_file
        return await transcribe_file(path, source_id)

    raise ValueError(f"Unsupported extension: {ext}")


def _extract_pdf(path: str) -> str:
    import pymupdf as fitz
    doc  = fitz.open(path)
    text = "\n".join(page.get_text() for page in doc)
    doc.close()
    logger.info(f"[Ingest] PDF extracted: {len(text)} chars from {Path(path).name}")
    return text


def _extract_office(path: str, ext: str) -> str:
    if ext == ".docx":
        from docx import Document
        doc   = Document(path)
        parts = []
        for block in doc.element.body:
            # Paragraphs
            from docx.oxml.ns import qn
            if block.tag == qn("w:p"):
                from docx.text.paragraph import Paragraph
                text = Paragraph(block, doc).text
                if text.strip():
                    parts.append(text)
            # Tables — extract each cell so tabular data isn't lost
            elif block.tag == qn("w:tbl"):
                from docx.table import Table
                for row in Table(block, doc).rows:
                    cells = [c.text.strip() for c in row.cells if c.text.strip()]
                    if cells:
                        parts.append("\t".join(cells))
        return "\n".join(parts)

    if ext == ".doc":
        # Old binary Word — try LibreOffice conversion, else reject cleanly
        return _libreoffice_to_text(path) or ""

    if ext in (".xlsx",):
        from openpyxl import load_workbook
        wb   = load_workbook(path, read_only=True, data_only=True)
        rows = []
        for ws in wb.worksheets:
            rows.append(f"[Sheet: {ws.title}]")
            for row in ws.iter_rows(values_only=True):
                line = "\t".join(str(c) for c in row if c is not None)
                if line.strip():
                    rows.append(line)
        return "\n".join(rows)

    if ext == ".pptx":
        from pptx import Presentation
        prs   = Presentation(path)
        parts = []
        for i, slide in enumerate(prs.slides, 1):
            slide_parts = []
            for shape in slide.shapes:
                if hasattr(shape, "text") and shape.text.strip():
                    slide_parts.append(shape.text.strip())
            # Presenter notes — often the richest content in lecture decks
            if slide.has_notes_slide:
                notes_text = slide.notes_slide.notes_text_frame.text.strip()
                if notes_text:
                    slide_parts.append(f"[Notes] {notes_text}")
            if slide_parts:
                parts.append(f"[Slide {i}]\n" + "\n".join(slide_parts))
        return "\n\n".join(parts)

    if ext == ".ppt":
        # Old binary PowerPoint — LibreOffice converts it to pptx, then we parse
        converted = _libreoffice_convert(path, "pptx")
        if converted:
            result = _extract_office(converted, ".pptx")
            try:
                os.remove(converted)
            except OSError:
                pass
            return result
        raise ValueError(
            ".ppt files require LibreOffice to be installed. "
            "Please save as .pptx and re-upload, or install LibreOffice."
        )

    return ""


def _libreoffice_convert(path: str, target_ext: str) -> str | None:
    """
    Use LibreOffice headless to convert a file. Returns path to converted file,
    or None if LibreOffice is not available.
    """
    import subprocess
    import tempfile
    import shutil

    lo_cmd = shutil.which("soffice") or shutil.which("libreoffice")
    if not lo_cmd:
        return None

    out_dir = tempfile.mkdtemp()
    try:
        subprocess.run(
            [lo_cmd, "--headless", "--convert-to", target_ext, "--outdir", out_dir, path],
            capture_output=True, timeout=60
        )
        stem      = Path(path).stem
        converted = os.path.join(out_dir, f"{stem}.{target_ext}")
        return converted if os.path.exists(converted) else None
    except Exception as e:
        logger.warning(f"[Ingest] LibreOffice conversion failed: {e}")
        return None


def _libreoffice_to_text(path: str) -> str | None:
    converted = _libreoffice_convert(path, "docx")
    if not converted:
        return None
    result = _extract_office(converted, ".docx")
    try:
        os.remove(converted)
    except OSError:
        pass
    return result


def _extract_html(path: str) -> str:
    from bs4 import BeautifulSoup
    html = Path(path).read_text(encoding="utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "nav", "footer"]):
        tag.decompose()
    return soup.get_text(separator=" ", strip=True)


# ── Hash ───────────────────────────────────────────────────────────────────

def file_hash(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


# ── Main ingestion entry point ─────────────────────────────────────────────

async def ingest_source(source_id: str):
    """
    Full ingestion pipeline for a source already registered in the DB.
    Updates status fields as it progresses.
    """
    source = db.get_source(source_id)
    if not source:
        logger.error(f"[Ingest] Source not found: {source_id}")
        return

    db.update_source_status(source_id, "processing")
    try:
        path      = source["path"]
        mime_type = source.get("mime_type", "")

        # Extract text
        text = await extract_text(path, mime_type, source_id)
        if not text.strip():
            raise ValueError("No text extracted — file may be empty or image-only")

        # Chunk
        raw_chunks = chunk_text(text)
        logger.info(f"[Ingest] {Path(path).name}: {len(raw_chunks)} chunks")

        # Embed in batches of 32 to stay memory-friendly on low-end hardware
        db.delete_chunks_for_source(source_id)
        batch_size = 32
        for batch_start in range(0, len(raw_chunks), batch_size):
            batch    = raw_chunks[batch_start:batch_start + batch_size]
            contents = [c["content"] for c in batch]
            vecs     = await asyncio.to_thread(embed, contents)
            for i, (chunk, vec) in enumerate(zip(batch, vecs)):
                db.insert_chunk(
                    source_id     = source_id,
                    collection_id = source["collection_id"],
                    chunk_index   = batch_start + i,
                    content       = chunk["content"],
                    char_start    = chunk["start"],
                    char_end      = chunk["end"],
                    embedding     = to_blob(vec),
                )

        db.update_source_status(source_id, "indexed")
        logger.info(f"[Ingest] Indexed: {Path(path).name}")

        # Background: compute cross-source similarity connections (non-critical)
        try:
            from connections import compute_connections
            asyncio.create_task(compute_connections(source_id))
        except Exception:
            pass

    except Exception as e:
        logger.exception(f"[Ingest] Failed: {source_id}")
        db.update_source_status(source_id, "failed", error_text=str(e))
