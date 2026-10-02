import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import db
from ollama_client import stream_chat
from config import MODEL_CONFIG

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collections/{cid}/guide", tags=["guide"])

_SOURCE_PROMPT = """\
You are a study assistant. Summarise the following source for a student.

Source: {name}

Instructions:
- Write 2-4 concise paragraphs.
- Cover: main topic, key concepts, and key takeaways.
- Use only the content below. Do not add outside knowledge.

Content:
{context}
"""

_OVERVIEW_PROMPT = """\
You are a study assistant. Using the source summaries below, write a concise \
Collection Overview for a student.

Cover:
## Overview
2-3 sentences describing what this collection is about overall.

## Key Themes
Bullet list of 4-8 themes that appear across multiple sources.

## How the Sources Connect
1-2 sentences on how the sources relate to or build on each other.

## Study Questions
5 questions a student can use to test understanding of the whole collection.

Only use the summaries provided. Do not add outside knowledge.

Source summaries:
{summaries}
"""


def _ev(status=None, content=None, done=False, error=False):
    d = {}
    if status  is not None: d["status"]  = status
    if content is not None: d["content"] = content
    if done:                d["done"]    = True
    if error:               d["error"]   = True
    return f"data: {json.dumps(d)}\n\n"


# ── Per-source guide ────────────────────────────────────────────────────────

@router.get("/sources")
def list_source_guides(cid: str):
    col = db.get_collection(cid)
    if not col:
        raise HTTPException(404, "Collection not found")
    return db.get_source_guides_for_collection(cid)


@router.post("/sources/{sid}")
async def generate_source_guide(cid: str, sid: str):
    source = db.get_source(sid)
    if not source or source["collection_id"] != cid:
        raise HTTPException(404, "Source not found")

    chunks = db.get_source_chunks(sid, limit=30)
    if not chunks:
        raise HTTPException(400, "Source has no indexed content")

    context = "\n\n".join(c["content"] for c in chunks)
    model   = MODEL_CONFIG.get("llm", "phi4-mini")
    msgs    = [
        {"role": "system", "content": "You are a helpful study assistant."},
        {"role": "user",   "content": _SOURCE_PROMPT.format(name=source["name"], context=context)},
    ]

    async def _stream():
        full = ""
        try:
            yield _ev(status="reading")
            async for chunk in stream_chat(model, msgs):
                full += chunk
                yield _ev(content=chunk)
            db.save_source_guide(sid, full)
            yield _ev(done=True)
        except Exception:
            logger.exception("[Guide/Source] Stream error for %s", sid)
            yield _ev(done=True, error=True)

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── Collection overview ─────────────────────────────────────────────────────

@router.get("/overview")
def get_overview(cid: str):
    col = db.get_collection(cid)
    if not col:
        raise HTTPException(404, "Collection not found")
    guide = db.get_guide(cid)
    return guide or {"content": None, "generated_at": None}


@router.post("/overview")
async def generate_overview(cid: str):
    col = db.get_collection(cid)
    if not col:
        raise HTTPException(404, "Collection not found")

    sources = db.get_source_guides_for_collection(cid)
    ready   = [s for s in sources if s.get("content")]
    if not ready:
        raise HTTPException(400, "Generate source summaries first")

    summaries = "\n\n---\n\n".join(
        f"[{s['name']}]\n{s['content']}" for s in ready
    )
    model = MODEL_CONFIG.get("llm", "phi4-mini")
    msgs  = [
        {"role": "system", "content": "You are a helpful study assistant."},
        {"role": "user",   "content": _OVERVIEW_PROMPT.format(summaries=summaries)},
    ]

    async def _stream():
        full = ""
        try:
            yield _ev(status="organising")
            async for chunk in stream_chat(model, msgs):
                full += chunk
                yield _ev(content=chunk)
            db.save_guide(cid, full)
            yield _ev(done=True)
        except Exception:
            logger.exception("[Guide/Overview] Stream error for %s", cid)
            yield _ev(done=True, error=True)

    return StreamingResponse(_stream(), media_type="text/event-stream")
