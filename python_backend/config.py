import os
import psutil
import logging

# Use cached HuggingFace models only — avoids slow network checks on every startup
os.environ.setdefault("HF_HUB_OFFLINE", "1")

logger = logging.getLogger(__name__)

# ── Paths ──────────────────────────────────────────────────────────────────
DATA_DIR    = os.environ.get("JADE_DATA_DIR", os.path.join(os.path.expanduser("~"), "AppData", "Roaming", "Jade"))
DB_PATH     = os.path.join(DATA_DIR, "jade.db")
UPLOADS_DIR = os.environ.get("JADE_UPLOADS_DIR", os.path.join(DATA_DIR, "uploads"))
os.makedirs(DATA_DIR,    exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")

# ── Embedding model ────────────────────────────────────────────────────────
# BAAI/bge-small-en-v1.5: 33M params, 384 dims — better than MiniLM, same speed
EMBEDDING_MODEL = os.environ.get("JADE_EMBED_MODEL", "BAAI/bge-small-en-v1.5")
EMBEDDING_DIM   = 384

# ── Hardware detection → model tiers ──────────────────────────────────────
def _detect_vram_gb() -> float:
    try:
        import subprocess
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5
        )
        if result.returncode == 0:
            return float(result.stdout.strip().split("\n")[0]) / 1024
    except Exception:
        pass
    return 0.0

def detect_model_tier() -> dict:
    ram_gb  = psutil.virtual_memory().total / (1024 ** 3)
    vram_gb = _detect_vram_gb()

    if ram_gb >= 12 and vram_gb >= 6:  # require 6 GB VRAM — 4 GB cards (e.g. RTX 3050) struggle with 7B
        llm   = "qwen2.5:7b"
        tier  = "high"
        whisper = "small"
    else:
        llm   = os.environ.get("JADE_LLM_LOW", "gemma2:2b")
        tier  = "low"
        whisper = "small"

    # Allow full override via env (e.g. set by Electron on first run)
    llm     = os.environ.get("JADE_LLM_MODEL", llm)
    whisper = os.environ.get("JADE_WHISPER_MODEL", whisper)

    logger.info(f"[Config] RAM={ram_gb:.1f}GB VRAM={vram_gb:.1f}GB -> tier={tier} llm={llm} whisper={whisper}")
    return {"tier": tier, "llm": llm, "whisper": whisper, "ram_gb": round(ram_gb, 1), "vram_gb": round(vram_gb, 1)}

# Resolved once at startup; imported by other modules
MODEL_CONFIG: dict = {}
