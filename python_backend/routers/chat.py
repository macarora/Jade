import asyncio
import json
import logging
import re
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import db
from search import hybrid_search
from ollama_client import stream_chat
from config import MODEL_CONFIG

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/collections/{cid}/chats", tags=["chat"])

# Conversational patterns that bypass RAG (basic greetings only)
_CONVERSATIONAL = re.compile(
    r"^(hi|hello|hey|thanks|thank you|bye|goodbye|how are you|what('s| is) your name)\W*$",
    re.IGNORECASE
)

# Enumeration intent — asking for a list, all items, numbered things
_ENUMERATE = re.compile(
    r"\b(all|every|each|list|how many|corollar|principle|step|phase|factor|reason|type|kind|example|finding)\b",
    re.IGNORECASE
)

# Summarisation intent — broad collection overview, no specific keyword to search
_SUMMARISE = re.compile(
    r"\b(summar(i[sz]e?|y)|overview|what('s| is) (this|it) about|give me an? (overview|summary|intro)|"
    r"(explain|describe) (the )?(collection|document|material|content|sources?)|"
    r"what (does|do) (this|these|it) (cover|contain|discuss|talk about))\b",
    re.IGNORECASE
)

_SYSTEM_PROMPT = """\
You are {brain_name}, a personal knowledge assistant. You answer questions \
ONLY using the source excerpts provided below. Do not use any outside knowledge.

Rules:
- If the answer is not found in the excerpts, say exactly: \
"I don't have information about that in this collection."
- Be concise and direct. Cite which source the answer comes from.
- Never make up facts or elaborate beyond what the excerpts contain.

Source excerpts:
{context}
"""


# ── Chat CRUD ──────────────────────────────────────────────────────────────

@router.get("")
def list_chats(cid: str):
    return db.list_chats(cid)


@router.post("", status_code=201)
def create_chat(cid: str):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")
    return db.create_chat(cid)


@router.get("/{chat_id}/messages")
def get_messages(cid: str, chat_id: str):
    return db.get_messages(chat_id)


# ── Send message + RAG stream ──────────────────────────────────────────────

class MessageBody(BaseModel):
    content: str


@router.post("/{chat_id}/messages")
async def send_message(cid: str, chat_id: str, body: MessageBody):
    col = db.get_collection(cid)
    if not col:
        raise HTTPException(404, "Collection not found")

    query      = body.content.strip()
    brain_name = db.get_setting("brain_name", "Jade")
    model      = MODEL_CONFIG.get("llm", "phi3.5-mini")

    # Persist user message
    db.add_message(chat_id, "user", query)

    # Auto-title the chat after the first user message
    existing = db.get_messages(chat_id)
    if len(existing) == 1:
        db.update_chat_title(chat_id, query[:60])

    def _ev(status=None, content=None, done=False, sources=None):
        d = {}
        if status  is not None: d["status"]  = status
        if content is not None: d["content"] = content
        if done:                d["done"]    = True
        if sources is not None: d["sources"] = sources
        return f"data: {json.dumps(d)}\n\n"

    # Conversational shortcut — no RAG needed
    if _CONVERSATIONAL.match(query):
        reply = f"Hi! I'm {brain_name}. Ask me anything about the sources in this collection."
        db.add_message(chat_id, "assistant", reply)
        async def _simple():
            yield _ev(content=reply, done=True, sources=[])
        return StreamingResponse(_simple(), media_type="text/event-stream")

    async def _stream():
        try:
            # Stage 1: search
            yield _ev(status="searching")
            history = db.get_messages(chat_id, limit=6)

            if _SUMMARISE.search(query):
                # Summarisation intent: grab top chunks by vector similarity to query
                import numpy as np
                from embeddings import embed_one, cosine_scores
                all_chunks = db.get_chunks_by_collection(cid)
                if all_chunks:
                    q_vec    = embed_one(query)
                    scores   = cosine_scores(q_vec, [c["embedding"] for c in all_chunks])
                    order    = np.argsort(-scores)[:12]
                    hits     = [{"source_id": all_chunks[i]["source_id"], "content": all_chunks[i]["content"]} for i in order]
                else:
                    hits = []
            else:
                top_k = 20 if _ENUMERATE.search(query) else 10
                hits = hybrid_search(query, cid, top_k=top_k)

            source_ids = list({h["source_id"] for h in hits})

            if not hits:
                no_info = "I don't have information about that in this collection."
                db.add_message(chat_id, "assistant", no_info, [])
                yield _ev(content=no_info, done=True, sources=[])
                return

            # Stage 2: reading / building context
            yield _ev(status="reading")
            context_parts = []
            for h in hits:
                src = db.get_source(h["source_id"])
                label = src["name"] if src else "Unknown source"
                context_parts.append(f"[{label}]\n{h['content']}")
            context = "\n\n---\n\n".join(context_parts)
            system  = _SYSTEM_PROMPT.format(brain_name=brain_name, context=context)
            msgs    = _build_chat_messages(system, history, query)

            # Stage 3: thinking (prefill / first token)
            yield _ev(status="thinking")

            full_reply = ""
            last_ping  = asyncio.get_event_loop().time()
            async for chunk in stream_chat(model, msgs):
                full_reply += chunk
                yield _ev(content=chunk)
                # Send SSE keepalive every 20s so browser doesn't drop the connection
                now = asyncio.get_event_loop().time()
                if now - last_ping > 20:
                    yield ": ping\n\n"
                    last_ping = now

            db.add_message(chat_id, "assistant", full_reply, source_ids)
            sources_meta = []
            for sid in source_ids:
                src = db.get_source(sid)
                if src:
                    sources_meta.append({"id": sid, "name": src["name"]})
            yield _ev(done=True, sources=sources_meta)

        except Exception as exc:
            import httpx as _httpx
            if isinstance(exc, (_httpx.ConnectError, _httpx.ConnectTimeout, _httpx.RemoteProtocolError)):
                err_msg = "The AI model is still warming up — please wait a moment and try again."
            else:
                logger.exception("[Chat] Stream error")
                err_msg = "Something went wrong. Please try your question again."
            db.add_message(chat_id, "assistant", err_msg, [])
            yield _ev(content=err_msg, done=True, sources=[])

    return StreamingResponse(_stream(), media_type="text/event-stream")


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_chat_messages(system: str, history: list[dict], current_query: str) -> list[dict]:
    msgs = [{"role": "system", "content": system}]
    # Include last 6 turns of history (excluding the message we just saved)
    for m in history[:-1]:
        msgs.append({"role": m["role"], "content": m["content"]})
    msgs.append({"role": "user", "content": current_query})
    return msgs
