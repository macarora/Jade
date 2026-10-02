import re
import sqlite3
import json
import uuid
from contextlib import contextmanager
from config import DB_PATH

# ── Connection ─────────────────────────────────────────────────────────────

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

@contextmanager
def get_db():
    conn = _get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

# ── Schema ─────────────────────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS collections (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT DEFAULT '#5ec87a',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
    id            TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    type          TEXT NOT NULL CHECK(type IN ('file','url')),
    name          TEXT NOT NULL,
    path          TEXT,
    url           TEXT,
    mime_type     TEXT,
    size_bytes    INTEGER,
    file_hash     TEXT,
    status        TEXT DEFAULT 'pending'
                       CHECK(status IN ('pending','processing','indexed','failed')),
    error_text    TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chunks (
    id            TEXT PRIMARY KEY,
    source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL,
    chunk_index   INTEGER NOT NULL,
    content       TEXT NOT NULL,
    char_start    INTEGER,
    char_end      INTEGER,
    embedding     BLOB,
    created_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chunks_collection ON chunks(collection_id);
CREATE INDEX IF NOT EXISTS idx_sources_collection ON sources(collection_id);
CREATE INDEX IF NOT EXISTS idx_sources_status ON sources(status);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    content='chunks',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS chunks_fts_insert AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_delete AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES('delete', old.rowid, old.content);
END;

CREATE TABLE IF NOT EXISTS chats (
    id            TEXT PRIMARY KEY,
    collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
    title         TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id         TEXT PRIMARY KEY,
    chat_id    TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK(role IN ('user','assistant')),
    content    TEXT NOT NULL,
    source_ids TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('brain_name', 'Jade');

CREATE TABLE IF NOT EXISTS guides (
    collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    content       TEXT NOT NULL,
    generated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_guides (
    source_id    TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
    content      TEXT NOT NULL,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS source_connections (
    source_a_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    source_b_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL,
    similarity    REAL NOT NULL,
    reason        TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY(source_a_id, source_b_id)
);
CREATE INDEX IF NOT EXISTS idx_connections_collection ON source_connections(collection_id);
CREATE INDEX IF NOT EXISTS idx_connections_a ON source_connections(source_a_id);
CREATE INDEX IF NOT EXISTS idx_connections_b ON source_connections(source_b_id);
"""

def init_db():
    with get_db() as conn:
        conn.executescript(SCHEMA)

# ── Collections ────────────────────────────────────────────────────────────

def create_collection(name: str, color: str = "#5ec87a") -> dict:
    cid = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO collections(id, name, color) VALUES (?,?,?)",
            (cid, name, color)
        )
    return get_collection(cid)

def get_collection(cid: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM collections WHERE id=?", (cid,)).fetchone()
    return dict(row) if row else None

def list_collections() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT c.*, COUNT(s.id) as source_count "
            "FROM collections c LEFT JOIN sources s ON s.collection_id=c.id "
            "GROUP BY c.id ORDER BY c.updated_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]

def update_collection(cid: str, name: str = None, color: str = None):
    fields, vals = [], []
    if name  is not None: fields.append("name=?");  vals.append(name)
    if color is not None: fields.append("color=?"); vals.append(color)
    if not fields:
        return
    vals += [cid]
    with get_db() as conn:
        conn.execute(f"UPDATE collections SET {','.join(fields)}, updated_at=datetime('now') WHERE id=?", vals)

def delete_collection(cid: str):
    with get_db() as conn:
        conn.execute("DELETE FROM collections WHERE id=?", (cid,))

# ── Sources ────────────────────────────────────────────────────────────────

def create_source(collection_id: str, type_: str, name: str, **kwargs) -> dict:
    sid = str(uuid.uuid4())
    cols = ["id", "collection_id", "type", "name"] + list(kwargs.keys())
    vals = [sid, collection_id, type_, name] + list(kwargs.values())
    ph   = ",".join(["?"] * len(cols))
    with get_db() as conn:
        conn.execute(f"INSERT INTO sources({','.join(cols)}) VALUES ({ph})", vals)
    return get_source(sid)

def get_source(sid: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sources WHERE id=?", (sid,)).fetchone()
    return dict(row) if row else None

def list_all_sources() -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM sources").fetchall()
    return [dict(r) for r in rows]


def list_sources(collection_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM sources WHERE collection_id=? ORDER BY created_at DESC",
            (collection_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def update_source_status(sid: str, status: str, error_text: str = None):
    with get_db() as conn:
        conn.execute(
            "UPDATE sources SET status=?, error_text=?, updated_at=datetime('now') WHERE id=?",
            (status, error_text, sid)
        )

def delete_source(sid: str):
    with get_db() as conn:
        conn.execute("DELETE FROM sources WHERE id=?", (sid,))

# ── Chunks ─────────────────────────────────────────────────────────────────

def insert_chunk(source_id: str, collection_id: str, chunk_index: int,
                 content: str, char_start: int, char_end: int, embedding: bytes):
    cid = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chunks(id,source_id,collection_id,chunk_index,content,char_start,char_end,embedding) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (cid, source_id, collection_id, chunk_index, content, char_start, char_end, embedding)
        )

def delete_chunks_for_source(source_id: str):
    with get_db() as conn:
        conn.execute("DELETE FROM chunks WHERE source_id=?", (source_id,))

def get_chunks_by_collection(collection_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, source_id, content, embedding FROM chunks WHERE collection_id=?",
            (collection_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def get_chunks_by_ids(ids: list[str]) -> list[dict]:
    if not ids:
        return []
    ph = ",".join(["?"] * len(ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, source_id, collection_id, content, embedding FROM chunks WHERE id IN ({ph})",
            ids
        ).fetchall()
    return [dict(r) for r in rows]

def _fts5_escape(query: str) -> str:
    """
    Convert a free-text query into a safe FTS5 MATCH expression.
    Each token is double-quoted so FTS5 never interprets them as
    column names, operators, or prefix wildcards. An empty string
    after stripping returns None (caller should skip the FTS query).
    """
    # Remove characters that are meaningless or dangerous inside FTS5 quotes
    clean = re.sub(r'["\x00-\x1f]', ' ', query)
    tokens = [t for t in clean.split() if t]
    if not tokens:
        return None
    # Double-quote each token → implicit AND
    return " ".join(f'"{t}"' for t in tokens)


def bm25_search(query: str, collection_id: str, limit: int = 50) -> list[dict]:
    """FTS5 BM25 search scoped to a collection. Returns rowid + rank."""
    fts_query = _fts5_escape(query)
    if not fts_query:
        return []
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.id, c.source_id, c.content, c.embedding, fts.rank
            FROM chunks_fts fts
            JOIN chunks c ON c.rowid = fts.rowid
            WHERE chunks_fts MATCH ? AND c.collection_id = ?
            ORDER BY fts.rank
            LIMIT ?
            """,
            (fts_query, collection_id, limit)
        ).fetchall()
    return [dict(r) for r in rows]

# ── Chats ──────────────────────────────────────────────────────────────────

def create_chat(collection_id: str, title: str = "New chat") -> dict:
    cid = str(uuid.uuid4())
    with get_db() as conn:
        conn.execute(
            "INSERT INTO chats(id, collection_id, title) VALUES (?,?,?)",
            (cid, collection_id, title)
        )
    return {"id": cid, "collection_id": collection_id, "title": title}

def list_chats(collection_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM chats WHERE collection_id=? ORDER BY updated_at DESC",
            (collection_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def get_messages(chat_id: str, limit: int = 20) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM messages WHERE chat_id=? ORDER BY created_at DESC LIMIT ?",
            (chat_id, limit)
        ).fetchall()
    msgs = [dict(r) for r in rows]
    msgs.reverse()
    for m in msgs:
        m["source_ids"] = json.loads(m["source_ids"]) if m.get("source_ids") else []
    return msgs

def add_message(chat_id: str, role: str, content: str, source_ids: list[str] = None) -> dict:
    mid = str(uuid.uuid4())
    src = json.dumps(source_ids) if source_ids else None
    with get_db() as conn:
        conn.execute(
            "INSERT INTO messages(id,chat_id,role,content,source_ids) VALUES (?,?,?,?,?)",
            (mid, chat_id, role, content, src)
        )
        conn.execute("UPDATE chats SET updated_at=datetime('now') WHERE id=?", (chat_id,))
    return {"id": mid, "chat_id": chat_id, "role": role, "content": content, "source_ids": source_ids or []}

def update_chat_title(chat_id: str, title: str):
    with get_db() as conn:
        conn.execute("UPDATE chats SET title=? WHERE id=?", (title, chat_id))

# ── Settings ───────────────────────────────────────────────────────────────

def get_setting(key: str, default: str = None) -> str | None:
    with get_db() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default

def set_setting(key: str, value: str):
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)", (key, value))

# ── Guides ─────────────────────────────────────────────────────────────────

def get_guide(collection_id: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT content, generated_at FROM guides WHERE collection_id=?", (collection_id,)
        ).fetchone()
    return dict(row) if row else None

def save_guide(collection_id: str, content: str):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO guides(collection_id, content, generated_at) VALUES (?,?,datetime('now'))",
            (collection_id, content)
        )

def get_source_guide(source_id: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT content, generated_at FROM source_guides WHERE source_id=?", (source_id,)
        ).fetchone()
    return dict(row) if row else None

def save_source_guide(source_id: str, content: str):
    with get_db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO source_guides(source_id, content, generated_at) VALUES (?,?,datetime('now'))",
            (source_id, content)
        )

def get_source_guides_for_collection(collection_id: str) -> list[dict]:
    """Returns all indexed sources with their guide content (None if not yet generated)."""
    with get_db() as conn:
        rows = conn.execute(
            """SELECT s.id, s.name, sg.content, sg.generated_at
               FROM sources s
               LEFT JOIN source_guides sg ON sg.source_id = s.id
               WHERE s.collection_id=? AND s.status='indexed'
               ORDER BY s.created_at""",
            (collection_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def get_chunks_for_source(source_id: str) -> list[dict]:
    """Returns all chunks (with embeddings) for a source — used for connection compute."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, content, embedding FROM chunks WHERE source_id=? ORDER BY chunk_index",
            (source_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def upsert_connections(pairs: list[dict]):
    with get_db() as conn:
        # Add reason column if missing (migration for existing DBs)
        try:
            conn.execute("ALTER TABLE source_connections ADD COLUMN reason TEXT")
        except Exception:
            pass
        for p in pairs:
            conn.execute(
                "INSERT OR REPLACE INTO source_connections(source_a_id,source_b_id,collection_id,similarity,reason) VALUES (?,?,?,?,?)",
                (p["source_a_id"], p["source_b_id"], p["collection_id"], p["similarity"], p.get("reason"))
            )

def get_connections_for_collection(collection_id: str) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT sc.source_a_id, sc.source_b_id, sc.similarity,
                      sa.name AS source_a_name, sb.name AS source_b_name
               FROM source_connections sc
               JOIN sources sa ON sa.id = sc.source_a_id
               JOIN sources sb ON sb.id = sc.source_b_id
               WHERE sc.collection_id = ?
               ORDER BY sc.similarity DESC""",
            (collection_id,)
        ).fetchall()
    return [dict(r) for r in rows]

def clear_all_connections():
    with get_db() as conn:
        conn.execute("DELETE FROM source_connections")


def delete_connections_for_source(source_id: str):
    with get_db() as conn:
        conn.execute(
            "DELETE FROM source_connections WHERE source_a_id=? OR source_b_id=?",
            (source_id, source_id)
        )

def get_source_chunks(source_id: str, limit: int = 30) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT content FROM chunks WHERE source_id=? ORDER BY chunk_index LIMIT ?",
            (source_id, limit)
        ).fetchall()
    return [dict(r) for r in rows]

def get_collection_chunks(collection_id: str, limit: int = 120) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT c.content, s.name as source_name
               FROM chunks c JOIN sources s ON c.source_id = s.id
               WHERE c.collection_id=? AND s.status='indexed'
               ORDER BY s.name, c.chunk_index
               LIMIT ?""",
            (collection_id, limit)
        ).fetchall()
    return [dict(r) for r in rows]
