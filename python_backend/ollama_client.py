import json
import logging
import httpx
from typing import AsyncGenerator
from config import OLLAMA_URL

logger = logging.getLogger(__name__)

# read=None: no per-chunk timeout for streaming — generation can be slow on CPU
TIMEOUT        = httpx.Timeout(connect=5.0, read=120.0, write=10.0, pool=5.0)
STREAM_TIMEOUT = httpx.Timeout(connect=5.0, read=None,  write=10.0, pool=5.0)

# Fixed context window: RAG prompts run ~5k tokens, and Ollama's VRAM-based default
# (as low as 2k) silently truncates them. Same value for chat and generate so
# switching between them never forces a model reload.
NUM_CTX = 8192


async def stream_chat(model: str, messages: list[dict]) -> AsyncGenerator[str, None]:
    """
    Stream a chat completion from Ollama.
    Yields text chunks as they arrive.
    """
    payload = {
        "model":    model,
        "messages": messages,
        "stream":   True,
        "options":  {"temperature": 0, "num_ctx": NUM_CTX},
    }
    async with httpx.AsyncClient(timeout=STREAM_TIMEOUT) as client:
        async with client.stream("POST", f"{OLLAMA_URL}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    data = json.loads(line)
                    text = data.get("message", {}).get("content", "")
                    if text:
                        yield text
                except json.JSONDecodeError:
                    continue


async def complete(model: str, prompt: str) -> str:
    """Non-streaming completion — for query rewriting, title generation, etc."""
    payload = {
        "model":   model,
        "prompt":  prompt,
        "stream":  False,
        "options": {"temperature": 0, "num_ctx": NUM_CTX},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "").strip()


async def health_check() -> bool:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


async def list_local_models() -> list[str]:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            return [m["name"] for m in resp.json().get("models", [])]
    except Exception:
        return []
