from fastapi import APIRouter
from pydantic import BaseModel

import db
import ollama_client
from config import MODEL_CONFIG, UPLOADS_DIR
from search import global_bm25_search

router = APIRouter(prefix="/api", tags=["settings"])


# ── Settings ───────────────────────────────────────────────────────────────

class SettingsUpdate(BaseModel):
    brain_name: str | None = None
    llm_model:  str | None = None


@router.get("/settings")
def get_settings():
    return {
        "brain_name":    db.get_setting("brain_name", "Jade"),
        "llm_model":     MODEL_CONFIG.get("llm"),
        "model_config":  MODEL_CONFIG,
    }


@router.patch("/settings")
def update_settings(body: SettingsUpdate):
    if body.brain_name is not None:
        name = body.brain_name.strip() or "Jade"
        db.set_setting("brain_name", name)
    if body.llm_model is not None and body.llm_model.strip():
        MODEL_CONFIG["llm"] = body.llm_model.strip()
        db.set_setting("llm_model", body.llm_model.strip())
    return get_settings()


# ── App config (read-only; writeable paths come via Electron IPC) ──────────

@router.get("/config")
def get_config():
    return {"sources_dir": UPLOADS_DIR}


# ── Status / health ────────────────────────────────────────────────────────

@router.get("/health")
async def health():
    ollama_ok = await ollama_client.health_check()
    return {
        "status":     "ok",
        "ollama":     ollama_ok,
        "llm_model":  MODEL_CONFIG.get("llm"),
        "tier":       MODEL_CONFIG.get("tier"),
    }


@router.get("/models")
async def list_models():
    return {"available": await ollama_client.list_local_models()}


# ── Global search (routing only — no LLM) ─────────────────────────────────

class GlobalSearchResult(BaseModel):
    collection_id:  str
    collection_name: str
    match_count:    int
    snippet:        str


@router.get("/search")
def global_search(q: str):
    if not q.strip():
        return []
    hits = global_bm25_search(q.strip(), top_collections=5)
    results = []
    for h in hits:
        col = db.get_collection(h["collection_id"])
        if col:
            results.append({
                "collection_id":   h["collection_id"],
                "collection_name": col["name"],
                "collection_color": col["color"],
                "match_count":     h["match_count"],
                "snippet":         h["snippet"],
            })
    return results
