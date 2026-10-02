import os
import glob
import numpy as np
import logging
from pathlib import Path
from sentence_transformers import SentenceTransformer
from config import EMBEDDING_DIM

logger = logging.getLogger(__name__)

_model: SentenceTransformer | None = None

def _resolve_model_path() -> str:
    """Return a local filesystem path to the bundled embedding model snapshot.
    Falls back to the HuggingFace Hub model name only in dev (when no cache dir set)."""
    models_cache = os.environ.get("JADE_MODELS_CACHE", "")
    if models_cache:
        # Hub cache layout: <models_cache>[/hub]/models--BAAI--bge-small-en-v1.5/snapshots/<hash>/
        # Build scripts copy the model folder directly under models_cache (no hub/), so check both.
        for base in (Path(models_cache) / "hub", Path(models_cache)):
            snapshots_dir = base / "models--BAAI--bge-small-en-v1.5" / "snapshots"
            if snapshots_dir.exists():
                for child in snapshots_dir.iterdir():
                    if (child / "modules.json").exists():
                        return str(child)
        logger.warning(f"[Embeddings] Bundled model not found under {models_cache}")
    return "BAAI/bge-small-en-v1.5"

def load_model():
    global _model
    if _model is None:
        model_path = _resolve_model_path()
        logger.info(f"[Embeddings] Loading from {model_path}…")
        _model = SentenceTransformer(model_path)
        logger.info("[Embeddings] Model ready.")
    return _model

def embed(texts: list[str]) -> np.ndarray:
    """Embed a batch of texts. Returns (N, DIM) float32 array."""
    model = load_model()
    vecs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return vecs.astype(np.float32)

def embed_one(text: str) -> np.ndarray:
    return embed([text])[0]

def to_blob(vec: np.ndarray) -> bytes:
    return vec.astype(np.float32).tobytes()

def from_blob(blob: bytes) -> np.ndarray:
    return np.frombuffer(blob, dtype=np.float32)

def cosine_scores(query_vec: np.ndarray, candidate_blobs: list[bytes]) -> np.ndarray:
    """
    Batch cosine similarity between one query vector and N candidate blobs.
    Both query and candidates are already L2-normalized (from embed), so
    dot product == cosine similarity.
    """
    if not candidate_blobs:
        return np.array([])
    matrix = np.stack([from_blob(b) for b in candidate_blobs])  # (N, DIM)
    return matrix @ query_vec  # (N,)
