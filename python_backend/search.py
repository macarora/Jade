import numpy as np
import logging
import db
from embeddings import embed_one, cosine_scores, from_blob

logger = logging.getLogger(__name__)

# Reciprocal rank fusion constant — higher k = smoother blending
_RRF_K = 60


def _rrf(ranks: list[int]) -> float:
    return sum(1.0 / (_RRF_K + r) for r in ranks)


def hybrid_search(query: str, collection_id: str, top_k: int = 10) -> list[dict]:
    """
    Two-stage hybrid search:
      1. BM25 (FTS5) → up to 50 candidates scoped to collection
      2. Re-rank candidates by cosine similarity to query embedding
      3. Combine via Reciprocal Rank Fusion → top_k results

    Returns list of dicts: {source_id, content, score, bm25_rank, vec_rank}
    """
    # ── Stage 1: BM25 candidates ──────────────────────────────────────────
    # Strip stop words so FTS5 MATCH only requires content words
    _STOP = {
        'a','an','the','is','are','was','were','be','been','being',
        'have','has','had','do','does','did','will','would','could','should',
        'may','might','shall','can','need','dare','ought','used',
        'i','me','my','myself','we','our','you','your','he','him','his',
        'she','her','they','them','their','it','its','this','that','these','those',
        'what','which','who','whom','whose','when','where','why','how',
        'and','but','or','nor','for','yet','so','if','then','than','because',
        'as','at','by','from','in','into','of','off','on','onto','out','over',
        'to','up','with','about','after','before','between','through','during',
        'not','no','nor','neither','both','either','all','each','every','few',
        'more','most','other','some','such','only','own','same','too','very',
        'just','also','well','here','there','were','was','been',
    }
    content_words = [w for w in query.lower().split() if w.isalpha() and w not in _STOP and len(w) > 2]
    safe_query = " ".join(content_words) if content_words else " ".join(
        w for w in query.split() if w.isalnum() or len(w) > 2
    ) or query
    try:
        bm25_hits = db.bm25_search(safe_query, collection_id, limit=50)
    except Exception as e:
        logger.warning(f"[Search] BM25 failed ({e}), falling back to vector-only")
        bm25_hits = []

    # ── Stage 2: Vector similarity on BM25 candidates ────────────────────
    query_vec = embed_one(query)

    # When BM25 returns very few hits, supplement with vector search across all chunks
    # so enumeration queries ("what were the corollaries") find all related chunks
    all_chunks = None
    if len(bm25_hits) < 5:
        all_chunks = db.get_chunks_by_collection(collection_id)

    if bm25_hits:
        blobs     = [h["embedding"] for h in bm25_hits]
        vec_sims  = cosine_scores(query_vec, blobs)
        vec_order = np.argsort(-vec_sims)

        bm25_rank_map = {h["id"]: i for i, h in enumerate(bm25_hits)}
        vec_rank_map  = {bm25_hits[i]["id"]: rank for rank, i in enumerate(vec_order)}

        scored = []
        seen_ids = set()
        for chunk in bm25_hits:
            cid  = chunk["id"]
            seen_ids.add(cid)
            rrf  = _rrf([bm25_rank_map[cid], vec_rank_map[cid]])
            scored.append({
                "source_id":  chunk["source_id"],
                "chunk_id":   cid,
                "content":    chunk["content"],
                "score":      float(vec_sims[bm25_rank_map[cid]]),
                "rrf":        rrf,
                "bm25_rank":  bm25_rank_map[cid],
                "vec_rank":   vec_rank_map[cid],
            })

        # Supplement with top vector results not already in BM25 hits
        if all_chunks:
            all_blobs  = [c["embedding"] for c in all_chunks]
            all_sims   = cosine_scores(query_vec, all_blobs)
            all_order  = np.argsort(-all_sims)[:top_k * 2]
            for rank, idx in enumerate(all_order):
                c = all_chunks[idx]
                if c["id"] not in seen_ids:
                    scored.append({
                        "source_id": c["source_id"],
                        "chunk_id":  c["id"],
                        "content":   c["content"],
                        "score":     float(all_sims[idx]),
                        "rrf":       _rrf([len(bm25_hits) + rank, rank]),
                        "bm25_rank": -1,
                        "vec_rank":  rank,
                    })

        scored.sort(key=lambda x: -x["rrf"])
    else:
        # Pure vector fallback: load all collection embeddings
        logger.info("[Search] No BM25 hits — falling back to pure vector search")
        all_chunks = db.get_chunks_by_collection(collection_id)
        if not all_chunks:
            return []
        blobs    = [c["embedding"] for c in all_chunks]
        vec_sims = cosine_scores(query_vec, blobs)
        order    = np.argsort(-vec_sims)[:top_k * 2]
        scored   = []
        for rank, idx in enumerate(order):
            c = all_chunks[idx]
            scored.append({
                "source_id": c["source_id"],
                "chunk_id":  c["id"],
                "content":   c["content"],
                "score":     float(vec_sims[idx]),
                "rrf":       float(vec_sims[idx]),
                "bm25_rank": -1,
                "vec_rank":  rank,
            })

    results = scored[:top_k]
    logger.info(
        f"[Search] query={query!r:.40} collection={collection_id[:8]} "
        f"bm25_candidates={len(bm25_hits)} returned={len(results)}"
    )
    return results


def global_bm25_search(query: str, top_collections: int = 5) -> list[dict]:
    """
    Keyword-only search across ALL collections for routing.
    Returns list of {collection_id, match_count, snippet} — no LLM involved.
    """
    try:
        import db as _db
        fts_query = _db._fts5_escape(query)
        if not fts_query:
            return []
        with _db.get_db() as conn:
            rows = conn.execute(
                """
                SELECT c.collection_id, COUNT(*) as match_count,
                       substr(c.content, 1, 300) as snippet
                FROM chunks_fts fts
                JOIN chunks c ON c.rowid = fts.rowid
                WHERE chunks_fts MATCH ?
                GROUP BY c.collection_id
                ORDER BY match_count DESC
                LIMIT ?
                """,
                (fts_query, top_collections)
            ).fetchall()
        return [_clean_result(dict(r)) for r in rows]
    except Exception as e:
        logger.error(f"[Search] Global BM25 failed: {e}")
        return []


def _clean_result(r: dict) -> dict:
    import re
    text = r.get("snippet", "")
    # Collapse whitespace and remove control characters
    text = re.sub(r'[\x00-\x08\x0b-\x1f\x7f]', ' ', text)
    text = re.sub(r'\s+', ' ', text).strip()
    # Drop leading fragments that are clearly not prose (starts with punctuation/math/number)
    # Try to advance to the first letter-starting word boundary
    m = re.search(r'(?<!\w)[A-Z][a-z]', text)
    if m and m.start() < 60:
        text = text[m.start():]
    # Truncate cleanly at a word boundary
    if len(text) > 100:
        cut = text[:100].rsplit(' ', 1)[0]
        text = cut + '…'
    r["snippet"] = text
    return r
