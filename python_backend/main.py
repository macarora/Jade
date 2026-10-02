import logging
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import config
import db
from routers import collections, sources, chat, settings, guide, graph

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────────────────────────────────
    logger.info("[Startup] Initialising database…")
    db.init_db()

    logger.info("[Startup] Detecting hardware and selecting model tier…")
    config.MODEL_CONFIG.update(config.detect_model_tier())
    # Restore any user-selected model override from DB
    saved_model = db.get_setting("llm_model")
    if saved_model:
        config.MODEL_CONFIG["llm"] = saved_model
        logger.info(f"[Startup] Model override from settings: {saved_model}")

    # Pre-load embedding model so the first query isn't slow
    logger.info("[Startup] Pre-loading embedding model…")
    try:
        from embeddings import load_model
        load_model()
    except Exception as e:
        logger.warning(f"[Startup] Embedding model pre-load failed (will retry on first query): {e}")

    # Reset any sources stuck in 'processing' from a previous crashed/killed run
    stuck = [s for s in db.list_all_sources() if s.get("status") == "processing"]
    if stuck:
        logger.warning(f"[Startup] Resetting {len(stuck)} stuck 'processing' source(s) to 'failed'")
        for s in stuck:
            db.update_source_status(s["id"], "failed", error_text="Server restarted mid-processing — click Retry")

    # Backfill connections for any indexed sources that predate this feature
    import asyncio
    from connections import compute_connections
    async def _backfill():
        # One-time migration only — re-running every launch floods Ollama for hours
        if db.get_setting("connections_backfill_v2") == "done":
            return
        indexed = [s for s in db.list_all_sources() if s.get("status") == "indexed"]
        if not indexed:
            db.set_setting("connections_backfill_v2", "done")
            return
        logger.info(f"[Startup] Recomputing connections for {len(indexed)} indexed source(s) (chunk-level)…")
        # Wipe old mean-embedding connections so stale ones don't linger
        db.clear_all_connections()
        for s in indexed:
            try:
                await compute_connections(s["id"])
            except Exception as e:
                logger.warning(f"[Startup] Connection backfill failed for {s['id']}: {e}")
        db.set_setting("connections_backfill_v2", "done")
        logger.info("[Startup] Connection backfill complete.")
    asyncio.create_task(_backfill())

    logger.info(f"[Startup] Ready — LLM={config.MODEL_CONFIG.get('llm')} tier={config.MODEL_CONFIG.get('tier')}")
    yield

    # ── Shutdown ─────────────────────────────────────────────────────────
    logger.info("[Shutdown] Bye.")


app = FastAPI(title="Jade Backend", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # Electron renderer is a file:// origin
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(collections.router)
app.include_router(sources.router)
app.include_router(chat.router)
app.include_router(settings.router)
app.include_router(guide.router)
app.include_router(graph.router)

# ── Serve built frontend in production ────────────────────────────────────
# Electron passes JADE_FRONTEND_DIR so the backend knows where the built
# React app lives. Falls back to ../frontend/dist for development.
_frontend_dir = os.environ.get(
    "JADE_FRONTEND_DIR",
    str(Path(__file__).parent.parent / "frontend" / "dist")
)
if Path(_frontend_dir).exists():
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="static")
    logger.info(f"[Startup] Serving frontend from {_frontend_dir}")
else:
    logger.info(f"[Startup] No frontend build found at {_frontend_dir} — API-only mode")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3001
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=port,
        log_level="info",
        access_log=False,
    )
