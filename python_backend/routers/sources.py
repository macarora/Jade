import os
import asyncio
import hashlib
from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File, Form, BackgroundTasks
from pydantic import BaseModel

import db
from ingest import ingest_source, file_hash, SUPPORTED_EXTENSIONS
from config import UPLOADS_DIR

router = APIRouter(prefix="/api/collections/{cid}/sources", tags=["sources"])


# ── List & delete ──────────────────────────────────────────────────────────

@router.get("")
def list_sources(cid: str):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")
    from transcribe import get_progress
    sources = db.list_sources(cid)
    for s in sources:
        if s.get("status") == "processing":
            p = get_progress(s["id"])
            s["progress"] = round(p, 3) if p is not None else None
        else:
            s["progress"] = None
    return sources


@router.delete("/{sid}", status_code=204)
def delete_source(cid: str, sid: str):
    src = db.get_source(sid)
    if not src or src["collection_id"] != cid:
        raise HTTPException(404, "Source not found")
    # Remove uploaded file if stored inside Jade's uploads dir
    if src.get("path") and src["path"].startswith(UPLOADS_DIR):
        try:
            os.remove(src["path"])
        except OSError:
            pass
    db.delete_source(sid)


# ── File upload ────────────────────────────────────────────────────────────

@router.post("/upload", status_code=202)
async def upload_file(
    cid: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")

    ext = Path(file.filename).suffix.lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    # Save to uploads dir
    dest = os.path.join(UPLOADS_DIR, cid)
    os.makedirs(dest, exist_ok=True)
    dest_path = os.path.join(dest, file.filename)

    content = await file.read()
    with open(dest_path, "wb") as f:
        f.write(content)

    fhash    = hashlib.sha256(content).hexdigest()
    mime_map = {
        ".pdf":  "application/pdf",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc":  "application/msword",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".ppt":  "application/vnd.ms-powerpoint",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".txt":  "text/plain",
        ".md":   "text/markdown",
        ".html": "text/html",
        ".mp3":  "audio/mpeg",
        ".wav":  "audio/wav",
        ".m4a":  "audio/mp4",
        ".mp4":  "video/mp4",
    }
    mime = mime_map.get(ext, "application/octet-stream")

    source = db.create_source(
        collection_id = cid,
        type_         = "file",
        name          = file.filename,
        path          = dest_path,
        mime_type     = mime,
        size_bytes    = len(content),
        file_hash     = fhash,
    )

    background_tasks.add_task(ingest_source, source["id"])
    return source


# ── URL ingestion ──────────────────────────────────────────────────────────

class UrlBody(BaseModel):
    url: str
    name: str | None = None


@router.post("/url", status_code=202)
async def add_url(cid: str, body: UrlBody, background_tasks: BackgroundTasks):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")

    # Scrape and save as a temp text file so ingest_source can treat it like any file
    try:
        import httpx
        from bs4 import BeautifulSoup

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(body.url, follow_redirects=True)
            resp.raise_for_status()

        soup  = BeautifulSoup(resp.text, "html.parser")
        for tag in soup(["script", "style", "nav", "footer"]):
            tag.decompose()
        text  = soup.get_text(separator=" ", strip=True)

        dest = os.path.join(UPLOADS_DIR, cid)
        os.makedirs(dest, exist_ok=True)
        safe_name = "".join(c for c in (body.name or body.url) if c.isalnum() or c in "-_.")[:80]
        dest_path = os.path.join(dest, f"{safe_name}.txt")
        Path(dest_path).write_text(text, encoding="utf-8")

    except Exception as e:
        raise HTTPException(400, f"Could not fetch URL: {e}")

    name   = body.name or body.url
    source = db.create_source(
        collection_id = cid,
        type_         = "url",
        name          = name,
        path          = dest_path,
        url           = body.url,
        mime_type     = "text/plain",
        size_bytes    = len(text.encode()),
    )

    background_tasks.add_task(ingest_source, source["id"])
    return source


# ── Cancel processing source ───────────────────────────────────────────────

@router.post("/{sid}/cancel", status_code=204)
def cancel_source(cid: str, sid: str):
    src = db.get_source(sid)
    if not src or src["collection_id"] != cid:
        raise HTTPException(404, "Source not found")
    if src["status"] != "processing":
        raise HTTPException(400, "Source is not processing")
    from transcribe import request_cancel
    request_cancel(sid)
    db.update_source_status(sid, "failed", error_text="Cancelled by user")


# ── Retry failed source ────────────────────────────────────────────────────

@router.post("/{sid}/retry", status_code=202)
async def retry_source(cid: str, sid: str, background_tasks: BackgroundTasks):
    src = db.get_source(sid)
    if not src or src["collection_id"] != cid:
        raise HTTPException(404, "Source not found")
    if src["status"] not in ("failed", "indexed"):
        raise HTTPException(400, "Source is not in a retryable state")
    db.update_source_status(sid, "pending")
    background_tasks.add_task(ingest_source, sid)
    return {"status": "queued"}
