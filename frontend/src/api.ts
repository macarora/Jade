import type { Collection, Source, Chat, Message, SearchResult, AppSettings, Connection } from './types';

const BASE = '/api';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') return undefined as T;
  return res.json() as Promise<T>;
}

// ── Shared SSE parser ───────────────────────────────────────────────────────
async function* _parseSSE(
  res: Response,
  onChunk: (text: string) => void,
  onStatus?: (status: string) => void,
): AsyncGenerator<{ done: boolean; error?: boolean }> {
  const reader  = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.status)  onStatus?.(data.status);
        if (data.content) onChunk(data.content);
        if (data.done)    yield { done: true, error: data.error };
      } catch { /* partial JSON */ }
    }
  }
}

// ── Collections ────────────────────────────────────────────────────────────
export const api = {
  collections: {
    list:   ()                                    => req<Collection[]>('/collections'),
    create: (name: string, color?: string)        => req<Collection>('/collections', { method: 'POST', body: JSON.stringify({ name, color }) }),
    update: (id: string, data: Partial<Collection>) => req<Collection>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string)                          => req<void>(`/collections/${id}`, { method: 'DELETE' }),
  },

  // ── Sources ──────────────────────────────────────────────────────────────
  sources: {
    list:   (cid: string)                  => req<Source[]>(`/collections/${cid}/sources`),
    delete: (cid: string, sid: string)     => req<void>(`/collections/${cid}/sources/${sid}`, { method: 'DELETE' }),
    cancel: (cid: string, sid: string)     => req<void>(`/collections/${cid}/sources/${sid}/cancel`, { method: 'POST' }),
    retry:  (cid: string, sid: string)     => req<{ status: string }>(`/collections/${cid}/sources/${sid}/retry`, { method: 'POST' }),

    uploadFile: (cid: string, file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return req<Source>(`/collections/${cid}/sources/upload`, {
        method: 'POST',
        headers: {},          // let browser set Content-Type with boundary
        body: fd,
      });
    },

    addUrl: (cid: string, url: string, name?: string) =>
      req<Source>(`/collections/${cid}/sources/url`, {
        method: 'POST',
        body: JSON.stringify({ url, name }),
      }),
  },

  // ── Chats ────────────────────────────────────────────────────────────────
  chats: {
    list:       (cid: string)              => req<Chat[]>(`/collections/${cid}/chats`),
    create:     (cid: string)              => req<Chat>(`/collections/${cid}/chats`, { method: 'POST' }),
    messages:   (cid: string, chatId: string) => req<Message[]>(`/collections/${cid}/chats/${chatId}/messages`),
  },

  // ── Streaming chat send ───────────────────────────────────────────────────
  async *sendMessage(
    cid: string,
    chatId: string,
    content: string,
    onChunk: (text: string) => void,
    onStatus?: (status: string) => void,
    signal?: AbortSignal,
  ): AsyncGenerator<{ done: boolean; sources?: { id: string; name: string }[] }> {
    const res = await fetch(`${BASE}/collections/${cid}/chats/${chatId}/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const reader  = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer    = '';
    signal?.addEventListener('abort', () => reader.cancel());
    while (true) {
      const { done, value } = await reader.read();
      if (done || signal?.aborted) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.status)  onStatus?.(data.status);
          if (data.content) onChunk(data.content);
          if (data.done)    yield { done: true, sources: data.sources ?? [] };
        } catch { /* partial JSON */ }
      }
    }
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  settings: {
    get:  ()                        => req<AppSettings>('/settings'),
    save: (brain_name: string)      => req<AppSettings>('/settings', { method: 'PATCH', body: JSON.stringify({ brain_name }) }),
  },

  // ── Guide ────────────────────────────────────────────────────────────────
  guide: {
    listSources: (cid: string) =>
      req<{ id: string; name: string; content: string | null; generated_at: string | null }[]>(
        `/collections/${cid}/guide/sources`
      ),

    getOverview: (cid: string) =>
      req<{ content: string | null; generated_at: string | null }>(`/collections/${cid}/guide/overview`),

    async *generateSource(
      cid: string,
      sid: string,
      onChunk: (text: string) => void,
      onStatus?: (status: string) => void,
      signal?: AbortSignal,
    ): AsyncGenerator<{ done: boolean; error?: boolean }> {
      const res = await fetch(`${BASE}/collections/${cid}/guide/sources/${sid}`, { method: 'POST', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      yield* _parseSSE(res, onChunk, onStatus);
    },

    async *generateOverview(
      cid: string,
      onChunk: (text: string) => void,
      onStatus?: (status: string) => void,
      signal?: AbortSignal,
    ): AsyncGenerator<{ done: boolean; error?: boolean }> {
      const res = await fetch(`${BASE}/collections/${cid}/guide/overview`, { method: 'POST', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      yield* _parseSSE(res, onChunk, onStatus);
    },
  },

  // ── Connections ───────────────────────────────────────────────────────────
  connections: {
    list: (cid: string) => req<Connection[]>(`/collections/${cid}/connections`),
  },

  // ── Knowledge graph ───────────────────────────────────────────────────────
  graph: {
    collections: () => req<{
      nodes: Array<{ id: string; name: string; color: string; source_count: number }>;
      edges: Array<{
        source: string; target: string; count: number; max_similarity: number;
        connections: Array<{ source_name: string; target_name: string; reason: string; similarity: number }>;
      }>;
    }>('/graph'),
  },

  // ── Global search ─────────────────────────────────────────────────────────
  search: (q: string) => req<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),

  // ── Health ───────────────────────────────────────────────────────────────
  health: () => req<{ status: string; ollama: boolean; llm_model: string; tier: string }>('/health'),
};
