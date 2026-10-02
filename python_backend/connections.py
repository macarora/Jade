import asyncio
import logging
import time
import numpy as np
import db
from embeddings import from_blob

logger = logging.getLogger(__name__)

SIMILARITY_THRESHOLD = 0.75
TOP_N_CHUNKS = 5
# Max chars of chunk content passed to LLM per excerpt
_EXCERPT_LEN = 500
# Seconds to skip LLM verification after Ollama fails (e.g. model can't load)
_OLLAMA_BACKOFF_S = 600
_ollama_down_until = 0.0


def _load_chunks(source_id: str) -> tuple[np.ndarray | None, list[str]]:
    """Returns (embedding_matrix, content_list) for a source."""
    chunks = db.get_chunks_for_source(source_id)
    valid = [(from_blob(c["embedding"]), c.get("content", ""))
             for c in chunks if c.get("embedding")]
    if not valid:
        return None, []
    vecs = np.array([v for v, _ in valid], dtype=np.float32)
    contents = [c for _, c in valid]
    return vecs, contents


def _chunk_similarity_and_best(
    vecs_a: np.ndarray, vecs_b: np.ndarray
) -> tuple[float, int, int]:
    """
    Returns (similarity_score, best_idx_a, best_idx_b).
    Similarity is MIN(mean top-N from A's view, mean top-N from B's view).
    """
    sim_matrix = vecs_a @ vecs_b.T          # (N_a, N_b)
    best_per_a = sim_matrix.max(axis=1)
    best_per_b = sim_matrix.max(axis=0)

    top_a = float(np.sort(best_per_a)[::-1][:TOP_N_CHUNKS].mean())
    top_b = float(np.sort(best_per_b)[::-1][:TOP_N_CHUNKS].mean())

    # Best matching chunk pair (for LLM prompt)
    flat_idx = int(sim_matrix.argmax())
    idx_a, idx_b = divmod(flat_idx, sim_matrix.shape[1])

    return min(top_a, top_b), idx_a, idx_b


async def _verify_with_ollama(
    name_a: str, excerpt_a: str,
    name_b: str, excerpt_b: str,
) -> str | None:
    """
    Ask the LLM whether two excerpts share a genuine conceptual connection.
    Returns a one-sentence reason, or None if not related.
    """
    global _ollama_down_until
    # After a failure, skip verification for a while instead of waiting ~2 min per pair
    if time.monotonic() < _ollama_down_until:
        return ""
    try:
        from ollama_client import complete
        from config import MODEL_CONFIG
        model = MODEL_CONFIG.get("llm", "llama3.2")

        prompt = (
            f"You are checking if two document excerpts share a genuine conceptual connection.\n\n"
            f"Excerpt A (from \"{name_a}\"):\n{excerpt_a[:_EXCERPT_LEN]}\n\n"
            f"Excerpt B (from \"{name_b}\"):\n{excerpt_b[:_EXCERPT_LEN]}\n\n"
            "If these excerpts share a specific concept, idea, or topic that would be "
            "useful for a student to understand together, respond with ONE sentence "
            "explaining the connection. Start with the shared concept.\n"
            "If they only share superficial vocabulary or are not genuinely related, "
            "respond with exactly: NOT RELATED\n\n"
            "Response:"
        )

        response = await complete(model, prompt)
        response = response.strip()

        if not response or response.upper().startswith("NOT RELATED"):
            return None
        # Truncate to one sentence
        sentence = response.split(".")[0].strip()
        return sentence + "." if not sentence.endswith(".") else sentence

    except Exception as e:
        logger.warning(f"[Connections] Ollama verification failed: {e} — storing without reason; "
                       f"skipping verification for {_OLLAMA_BACKOFF_S // 60} min")
        _ollama_down_until = time.monotonic() + _OLLAMA_BACKOFF_S
        return ""   # empty string = "unverified but above threshold"


async def compute_connections(source_id: str):
    """
    Run after a source is indexed.
    1. Chunk-level cosine similarity (threshold 0.75) as pre-filter.
    2. Ollama verifies each passing pair and generates a one-sentence reason.
    Pairs the LLM rejects are discarded; approved pairs are stored with their reason.
    """
    source = db.get_source(source_id)
    if not source:
        return

    all_sources = db.list_all_sources()
    others = [s for s in all_sources
              if s["id"] != source_id and s.get("status") == "indexed"]
    if not others:
        return

    vecs_a, contents_a = await asyncio.to_thread(_load_chunks, source_id)
    if vecs_a is None:
        return

    pairs = []
    for other in others:
        vecs_b, contents_b = await asyncio.to_thread(_load_chunks, other["id"])
        if vecs_b is None:
            continue

        sim, idx_a, idx_b = await asyncio.to_thread(
            _chunk_similarity_and_best, vecs_a, vecs_b
        )

        if sim < SIMILARITY_THRESHOLD:
            logger.debug(
                f"[Connections] '{source['name']}' <-> '{other['name']}': {sim:.3f} (below threshold)"
            )
            continue

        logger.info(
            f"[Connections] '{source['name']}' <-> '{other['name']}': {sim:.3f} — verifying…"
        )

        excerpt_a = contents_a[idx_a] if idx_a < len(contents_a) else ""
        excerpt_b = contents_b[idx_b] if idx_b < len(contents_b) else ""

        reason = await _verify_with_ollama(
            source["name"], excerpt_a,
            other["name"], excerpt_b,
        )

        if reason is None:
            logger.info(
                f"[Connections] '{source['name']}' <-> '{other['name']}': rejected by LLM"
            )
            continue

        # Canonical ordering: smaller id first
        a, b = (source_id, other["id"]) if source_id < other["id"] else (other["id"], source_id)
        a_src = source if a == source_id else other
        pairs.append({
            "source_a_id": a,
            "source_b_id": b,
            "collection_id": a_src["collection_id"],
            "similarity": round(sim, 4),
            "reason": reason,
        })
        logger.info(
            f"[Connections] Stored: '{source['name']}' <-> '{other['name']}' — \"{reason}\""
        )

    if pairs:
        await asyncio.to_thread(db.upsert_connections, pairs)
        logger.info(
            f"[Connections] {len(pairs)} connection(s) stored for '{source['name']}'"
        )
    else:
        logger.info(f"[Connections] No verified connections for '{source['name']}'")
