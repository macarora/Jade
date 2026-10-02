import React, { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api';
import type { Collection, Source, Chat, Message, SourceMeta, ActiveTab, Connection } from '../types';
import { KnowledgeGraph } from './Graph';

interface Props {
  collection:        Collection;
  brainName:         string;
  activeTab:         ActiveTab;
  onTab:             (t: ActiveTab) => void;
  onBack:            () => void;
  onDelete:          (c: Collection) => void;
  onRename:          (c: Collection) => void;
  onOpenCollection:  (id: string) => void;
}

export function CollectionView({ collection, brainName, activeTab, onTab, onBack, onDelete, onRename, onOpenCollection }: Props) {

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="col-header">
        <div className="breadcrumb">
          <button onClick={onBack}>Collections</button>
          <span>›</span>
          <span>{collection.name}</span>
        </div>
        <div className="col-title-row">
          <div className="col-badge" style={{ background: collection.color }} />
          <div className="col-title">{collection.name}</div>
          <button className="col-header-action" onClick={() => onRename(collection)} title="Rename">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5zM8.5 3.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Rename
          </button>
          <button className="col-header-action danger" onClick={() => onDelete(collection)} title="Delete">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
              <path d="M2 3.5h10M5.5 3.5V2.5h3v1M6 6v4M8 6v4M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Delete
          </button>
        </div>
        <div className="tabs">
          <button className={`tab${activeTab === 'chat' ? ' active' : ''}`} onClick={() => onTab('chat')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2h10a1 1 0 011 1v6a1 1 0 01-1 1H5l-3 2V3a1 1 0 011-1z"/>
            </svg>
            Chat
          </button>
          <button className={`tab${activeTab === 'sources' ? ' active' : ''}`} onClick={() => onTab('sources')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 2h8a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/>
              <path d="M5 5h4M5 7.5h4M5 10h2"/>
            </svg>
            Sources
          </button>
          <button className={`tab${activeTab === 'guide' ? ' active' : ''}`} onClick={() => onTab('guide')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2h10a1 1 0 011 1v9a1 1 0 01-1 1H2a1 1 0 01-1-1V3a1 1 0 011-1z"/>
              <path d="M4 5h6M4 7.5h6M4 10h3"/>
            </svg>
            Collection Guide
          </button>
          <button className={`tab${activeTab === 'connections' ? ' active' : ''}`} onClick={() => onTab('connections')}>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <circle cx="7" cy="3" r="1.6"/>
              <circle cx="2.5" cy="11" r="1.6"/>
              <circle cx="11.5" cy="11" r="1.6"/>
              <path d="M7 4.6l-4.5 4.8M7 4.6l4.5 4.8" strokeLinecap="round"/>
            </svg>
            Connections
          </button>
        </div>
      </div>

      {activeTab === 'sources'     && <SourcesTab collection={collection} />}
      {activeTab === 'guide'       && <GuideTab   collection={collection} />}
      {activeTab === 'connections' && (
        <KnowledgeGraph
          onOpenCollection={id => { onOpenCollection(id); onTab('chat'); }}
          onClose={() => onTab('chat')}
        />
      )}
      {/* ChatTab stays mounted so streaming survives tab switches — hidden with CSS when inactive */}
      <div style={{ display: activeTab === 'chat' ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <ChatTab collection={collection} brainName={brainName} />
      </div>
    </div>
  );
}

// ── Sources Tab ────────────────────────────────────────────────────────────

function SourcesTab({ collection }: { collection: Collection }) {
  const [sources,     setSources]     = useState<Source[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [dragging, setDragging] = useState(false);
  const [urlMode, setUrlMode]   = useState(false);
  const [urlVal, setUrlVal]     = useState('');
  const [urlName, setUrlName]   = useState('');
  const fileRef                 = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api.sources.list(collection.id).then(setSources).catch(console.error);
    api.connections.list(collection.id).then(setConnections).catch(() => {});
  }, [collection.id]);

  useEffect(() => { load(); }, [load]);

  // Poll while any source is processing/pending
  useEffect(() => {
    const hasActive = sources.some(s => s.status === 'pending' || s.status === 'processing');
    if (!hasActive) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [sources, load]);

  async function uploadFiles(files: File[]) {
    for (const f of files) {
      try {
        await api.sources.uploadFile(collection.id, f);
      } catch (e) {
        console.error(e);
      }
    }
    load();
  }

  async function addUrl() {
    if (!urlVal.trim()) return;
    try {
      await api.sources.addUrl(collection.id, urlVal.trim(), urlName.trim() || undefined);
      setUrlMode(false); setUrlVal(''); setUrlName('');
      load();
    } catch (e) {
      alert(`Could not add URL: ${(e as Error).message}`);
    }
  }

  const docs  = sources.filter(s => s.mime_type && !s.mime_type.startsWith('audio') && !s.mime_type.startsWith('video'));
  const media = sources.filter(s => s.mime_type && (s.mime_type.startsWith('audio') || s.mime_type.startsWith('video')));

  const indexed = sources.filter(s => s.status === 'indexed').length;

  // Map each source id → the names of sources it's connected to
  const connectedNames: Record<string, string[]> = {};
  for (const c of connections) {
    (connectedNames[c.source_a_id] ??= []).push(c.source_b_name);
    (connectedNames[c.source_b_id] ??= []).push(c.source_a_name);
  }

  return (
    <div className="sources-panel">
      {/* Drop zone */}
      <div
        className={`drop-zone${dragging ? ' over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault(); setDragging(false);
          const files = Array.from(e.dataTransfer.files);
          if (files.length) uploadFiles(files);
        }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" multiple accept=".pdf,.docx,.doc,.pptx,.ppt,.xlsx,.txt,.md,.html,.mp3,.wav,.m4a,.mp4"
          onChange={e => { if (e.target.files?.length) uploadFiles(Array.from(e.target.files)); }} />
        Drop files here or click to browse
        <div style={{ fontSize: '10px', marginTop: 4 }}>PDF · Word · PowerPoint · Excel · Audio · Video</div>
      </div>

      <div className="toolbar">
        <button className="btn-g" onClick={() => setUrlMode(v => !v)}>+ Add URL</button>
        <span className="toolbar-right">
          {sources.length} sources · {indexed} indexed
        </span>
      </div>

      {urlMode && (
        <div className="url-form" style={{ marginBottom: 16 }}>
          <input className="url-input" placeholder="https://…" value={urlVal} onChange={e => setUrlVal(e.target.value)} />
          <input className="url-input" placeholder="Label (optional)" value={urlName} onChange={e => setUrlName(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-g" onClick={() => setUrlMode(false)}>Cancel</button>
            <button className="btn-p" onClick={addUrl}>Add</button>
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <>
          <div className="src-section-label">Documents</div>
          {docs.map(s => <SourceRow key={s.id} source={s} connectedTo={connectedNames[s.id]} onDelete={() => api.sources.delete(collection.id, s.id).then(load)} onRetry={() => api.sources.retry(collection.id, s.id).then(load)} onCancel={() => api.sources.cancel(collection.id, s.id).then(load)} />)}
        </>
      )}
      {media.length > 0 && (
        <>
          <div className="src-section-label">Audio &amp; Video</div>
          {media.map(s => <SourceRow key={s.id} source={s} connectedTo={connectedNames[s.id]} onDelete={() => api.sources.delete(collection.id, s.id).then(load)} onRetry={() => api.sources.retry(collection.id, s.id).then(load)} onCancel={() => api.sources.cancel(collection.id, s.id).then(load)} />)}
        </>
      )}
      {sources.length === 0 && (
        <div style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 8 }}>No sources yet. Add files or a URL above.</div>
      )}
    </div>
  );
}

function SourceRow({ source, connectedTo, onDelete, onRetry, onCancel }: { source: Source; connectedTo?: string[]; onDelete: () => void; onRetry: () => void; onCancel: () => void }) {
  const isMedia    = source.mime_type?.startsWith('audio') || source.mime_type?.startsWith('video');
  const ext        = source.name.split('.').pop()?.toUpperCase() ?? '?';
  const size       = source.size_bytes ? formatBytes(source.size_bytes) : '';
  const processing = source.status === 'processing';
  const progress   = (source as any).progress as number | null;

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!processing) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [processing]);

  return (
    <div className="src-row" style={{ flexWrap: 'wrap' }}>
      <div className="src-icon" style={{ background: iconBg(source), color: iconColor(source) }}>
        {isMedia ? '🎙' : ext.slice(0, 4)}
      </div>
      <div className="src-info">
        <div className="src-name" title={source.name}>{source.name}</div>
        <div className="src-meta">{[source.type === 'url' ? 'Web link' : ext, size].filter(Boolean).join(' · ')}</div>
      </div>
      <div className="src-actions">
        {source.status === 'failed' && (
          <button className="src-action-btn" onClick={onRetry} title="Retry">↻</button>
        )}
        {processing && (
          <button className="src-action-btn danger" onClick={onCancel} title="Stop processing">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
              <rect x="0" y="0" width="8" height="8" rx="1.5"/>
            </svg>
          </button>
        )}
        {!processing && (
          <button className="src-action-btn danger" onClick={() => { if (confirm(`Remove "${source.name}"?`)) onDelete(); }} title="Remove">✕</button>
        )}
      </div>
      <span className={`src-status st-${source.status}`}>{source.status}</span>
      {connectedTo && connectedTo.length > 0 && (
        <span className="src-connections" title={`Related to: ${connectedTo.join(', ')}`}>
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <circle cx="2" cy="6" r="1.5"/><circle cx="10" cy="2" r="1.5"/><circle cx="10" cy="10" r="1.5"/>
            <line x1="3.5" y1="5.2" x2="8.5" y2="2.8"/><line x1="3.5" y1="6.8" x2="8.5" y2="9.2"/>
          </svg>
          {connectedTo.length} related
        </span>
      )}
      {processing && (
        <div className="src-progress-wrap">
          <div className="src-progress-bar">
            <div className="src-progress-fill" style={{ width: progress != null ? `${Math.round(progress * 100)}%` : '0%' }} />
          </div>
          <span className="src-progress-label">
            {progress != null ? `${Math.round(progress * 100)}%` : 'starting…'}
            {elapsed > 0 && ` · ${fmtElapsed(elapsed)}`}
          </span>
        </div>
      )}
    </div>
  );
}

function fmtElapsed(s: number) {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Chat Tab ───────────────────────────────────────────────────────────────

type Bookmark = { question: string; collName: string; collColor: string; collId: string };

function loadBookmarks(): Record<string, Bookmark> {
  try { return JSON.parse(localStorage.getItem('jade-bookmarks') || '{}'); } catch { return {}; }
}

function saveBookmarks(bms: Record<string, Bookmark>) {
  localStorage.setItem('jade-bookmarks', JSON.stringify(bms));
  window.dispatchEvent(new Event('jade-bookmarks-updated'));
}

function ChatTab({ collection, brainName }: { collection: Collection; brainName: string }) {
  const [chat, setChat]       = useState<Chat | null>(null);
  const [messages, setMsgs]   = useState<Message[]>([]);
  const [input, setInput]     = useState('');
  const [streaming, setStream]= useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamStatus, setStreamStatus] = useState('');
  const [, setStreamSrcs] = useState<SourceMeta[]>([]);
  const [chatError, setChatError] = useState('');
  const [bookmarks, setBookmarks] = useState<Record<string, Bookmark>>(loadBookmarks);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText]   = useState('');
  const bottomRef             = useRef<HTMLDivElement>(null);
  const taRef                 = useRef<HTMLTextAreaElement>(null);
  const abortCtrl             = useRef<AbortController | null>(null);

  // Keep bookmarks in sync if another tab/component updates them
  useEffect(() => {
    const sync = () => setBookmarks(loadBookmarks());
    window.addEventListener('jade-bookmarks-updated', sync);
    return () => window.removeEventListener('jade-bookmarks-updated', sync);
  }, []);

  useEffect(() => {
    api.chats.list(collection.id).then(chats => {
      if (chats.length > 0) {
        setChat(chats[0]);
        api.chats.messages(collection.id, chats[0].id).then(setMsgs);
      } else {
        api.chats.create(collection.id).then(c => { setChat(c); setMsgs([]); });
      }
    }).catch(console.error);
  }, [collection.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, streamText]);

  function toggleBookmark(msgId: string, question: string) {
    const next = { ...bookmarks };
    if (next[msgId]) { delete next[msgId]; }
    else { next[msgId] = { question, collName: collection.name, collColor: collection.color, collId: collection.id }; }
    setBookmarks(next);
    saveBookmarks(next);
  }

  function startEdit(msg: Message) {
    setEditingId(msg.id);
    setEditText(msg.content);
  }

  async function saveEdit() {
    const text = editText.trim();
    if (!text) return;
    setEditingId(null);
    await sendText(text);
  }

  function stopStream() {
    abortCtrl.current?.abort();
    abortCtrl.current = null;
    setStream(false);
    setStreamText('');
    setStreamStatus('');
  }

  async function send() {
    if (!input.trim() || streaming || !chat) return;
    setInput('');
    await sendText(input.trim());
  }

  async function sendText(q: string) {
    if (!q || streaming || !chat) return;
    setMsgs(m => [...m, { id: crypto.randomUUID(), chat_id: chat.id, role: 'user', content: q, source_ids: [], created_at: new Date().toISOString() }]);
    setStream(true);
    setStreamText('');
    setStreamStatus('');
    setStreamSrcs([]);
    setChatError('');
    const ctrl = new AbortController();
    abortCtrl.current = ctrl;

    try {
      for await (const ev of api.sendMessage(
        collection.id, chat.id, q,
        chunk => setStreamText(t => t + chunk),
        status => setStreamStatus(status),
        ctrl.signal,
      )) {
        if (ev.done) {
          const srcs = ev.sources ?? [];
          // Await before clearing stream so there's no gap where neither the
          // streaming bubble nor the saved assistant reply is visible
          try {
            const msgs = await api.chats.messages(collection.id, chat.id);
            setMsgs(srcs.length > 0
              ? msgs.map((m, i) => i === msgs.length - 1 && m.role === 'assistant' ? { ...m, sources: srcs } : m)
              : msgs);
          } catch (_) {}
          setStreamText('');
          setStreamSrcs([]);
        }
      }
    } catch (e: unknown) {
      const msg = (e instanceof Error) ? e.message : String(e);
      if (msg.includes('503'))
        setChatError('The AI model is still loading — wait a moment and try again.');
      else if (msg.includes('AbortError') || msg.includes('abort'))
        setChatError('');
      else
        setChatError('Something went wrong. Try again or restart Jade.');
    } finally {
      setStream(false);
      setStreamStatus('');
    }
  }

  return (
    <div className="chat-panel">
      <div className="messages">
        {messages.length === 0 && !streaming && (
          <div className="chat-empty">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Ask anything in this collection
          </div>
        )}
        <div className="msg-wrap">
          {messages.map((m, i) => (
            m.role === 'user' ? (
              <div key={m.id} className="msg msg-user">
                <div className="msg-user-inner">
                  {editingId === m.id ? (
                    <div className="msg-edit-mode active">
                      <textarea
                        className="msg-edit-ta"
                        value={editText}
                        autoFocus
                        rows={3}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => {
                          if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); saveEdit(); }
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                      />
                      <div className="msg-edit-btns">
                        <button className="btn-sm-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                        <button className="btn-sm-primary" onClick={saveEdit} disabled={!editText.trim()}>Save &amp; resend</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="bubble">{m.content}</div>
                      <div className="msg-user-actions">
                        <button className="edit-btn" onClick={() => startEdit(m)}>
                          <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M8 2l2 2-6 6H2v-2L8 2z"/><path d="M7 3l2 2"/>
                          </svg>
                          Edit
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div key={m.id} className={`msg msg-ai${bookmarks[m.id] ? ' bookmarked' : ''}`}>
                <div className="msg-ai-header">
                  <div className="ai-avatar">
                    <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                      <path d="M6 1v10M1 6h10M3 3l6 6M9 3L3 9"/>
                    </svg>
                  </div>
                  <span className="ai-name">{brainName}</span>
                  {(m.sources?.length ?? 0) > 0 && (
                    <div className="ai-badge">{m.sources!.length} {m.sources!.length === 1 ? 'source' : 'sources'}</div>
                  )}
                </div>
                <div className="msg-ai-body">
                  <div className="ai-bubble">
                    <div className="msg-body-text"><GuideMarkdown text={m.content} /></div>
                  </div>
                  <div className="msg-actions">
                    <button
                      className={`bm-btn${bookmarks[m.id] ? ' active' : ''}`}
                      onClick={() => {
                        const question = messages[i - 1]?.role === 'user' ? messages[i - 1].content : m.content;
                        toggleBookmark(m.id, question);
                      }}
                    >
                      <svg viewBox="0 0 12 14" width="12" height="12" fill={bookmarks[m.id] ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 1h8a1 1 0 011 1v11l-5-3-5 3V2a1 1 0 011-1z"/>
                      </svg>
                      {bookmarks[m.id] ? 'Saved' : 'Bookmark'}
                    </button>
                  </div>
                </div>
                {(m.sources?.length ?? 0) > 0 && (
                  <div className="msg-source-chips">
                    {m.sources!.map(s => (
                      <span key={s.id} className="chip" title={s.name}>
                        <span className="chip-dot" style={{ background: collection.color }} />
                        {s.name.length > 30 ? s.name.slice(0, 28) + '…' : s.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          ))}
          {streaming && (
            <div className="msg msg-ai">
              <div className="msg-ai-header">
                <div className="ai-avatar">
                  <svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 1v10M1 6h10M3 3l6 6M9 3L3 9"/>
                  </svg>
                </div>
                <span className="ai-name">{brainName}</span>
              </div>
              <div className="msg-ai-body">
                <div className="ai-bubble">
                  <div className="msg-body-text" style={{ whiteSpace: 'pre-wrap' }}>
                    {streamText || <ThinkingIndicator status={streamStatus} />}
                  </div>
                </div>
              </div>
            </div>
          )}
          {chatError && (
            <div className="chat-error">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                <circle cx="7" cy="7" r="6"/><line x1="7" y1="4.5" x2="7" y2="7"/><line x1="7" y1="9.5" x2="7.01" y2="9.5"/>
              </svg>
              {chatError}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="chat-footer-wrap">
        <div className="chat-footer">
          <div className="chat-input-box">
            <textarea
              ref={taRef}
              className="chat-input"
              value={input}
              placeholder="Ask anything in this collection…"
              onChange={e => { setInput(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
            />
            {streaming ? (
              <button className="send-btn send-btn--stop" onClick={stopStream} title="Stop">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                  <rect x="1" y="1" width="8" height="8" rx="1.5"/>
                </svg>
              </button>
            ) : (
              <button className="send-btn" onClick={send} disabled={!input.trim()}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M1 7h12M7 1l6 6-6 6" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
          <div className="chat-hint">Searching within: <span style={{ color: 'var(--accent)' }}>{collection.name}</span></div>
        </div>
      </div>
    </div>
  );
}

// ── Guide Tab ──────────────────────────────────────────────────────────────

interface SourceGuide {
  id: string;
  name: string;
  content: string | null;
  generated_at: string | null;
}

function GuideTab({ collection }: { collection: Collection }) {
  const [sources,        setSources]        = useState<SourceGuide[]>([]);
  const [overview,       setOverview]       = useState<{ content: string | null; generated_at: string | null }>({ content: null, generated_at: null });
  const [generating,     setGenerating]     = useState(false);
  const [generatingId,   setGeneratingId]   = useState<string | null>(null);
  const [streamTexts,    setStreamTexts]    = useState<Record<string, string>>({});
  const [streamStatus,   setStreamStatus]   = useState('');
  const [ovStreaming,    setOvStreaming]     = useState(false);
  const [ovStreamText,   setOvStreamText]   = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const [srcs, ov] = await Promise.all([
        api.guide.listSources(collection.id),
        api.guide.getOverview(collection.id),
      ]);
      setSources(srcs);
      setOverview(ov);
    } catch { /* backend not ready yet */ }
  }, [collection.id]);

  useEffect(() => { load(); }, [load]);

  async function generateAll() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGenerating(true);
    setStreamStatus('');

    // Fresh list so we know which are pending
    let srcs: SourceGuide[];
    try {
      srcs = await api.guide.listSources(collection.id);
    } catch {
      setGenerating(false); abortRef.current = null; return;
    }
    setSources(srcs);

    for (const src of srcs) {
      if (ctrl.signal.aborted) break;
      if (src.content) continue; // already done

      setGeneratingId(src.id);
      setStreamTexts(t => ({ ...t, [src.id]: '' }));
      setStreamStatus('reading');

      try {
        for await (const ev of api.guide.generateSource(
          collection.id, src.id,
          chunk => setStreamTexts(t => ({ ...t, [src.id]: (t[src.id] ?? '') + chunk })),
          status => setStreamStatus(status),
          ctrl.signal,
        )) {
          if (ev.done) {
            // Reload fresh from DB so saved content populates the card
            const updated = await api.guide.listSources(collection.id);
            setSources(updated);
            setStreamTexts(t => { const n = { ...t }; delete n[src.id]; return n; });
          }
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') break;
        // Non-abort error: skip this source and continue
      }
    }

    setGenerating(false);
    setGeneratingId(null);
    setStreamTexts({});
    setStreamStatus('');
    abortRef.current = null;
  }

  async function regenerateSource(src: SourceGuide) {
    if (generating) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setGenerating(true);
    setGeneratingId(src.id);
    setStreamTexts(t => ({ ...t, [src.id]: '' }));
    setStreamStatus('reading');

    try {
      for await (const ev of api.guide.generateSource(
        collection.id, src.id,
        chunk => setStreamTexts(t => ({ ...t, [src.id]: (t[src.id] ?? '') + chunk })),
        status => setStreamStatus(status),
        ctrl.signal,
      )) {
        if (ev.done) {
          const updated = await api.guide.listSources(collection.id);
          setSources(updated);
          setStreamTexts(t => { const n = { ...t }; delete n[src.id]; return n; });
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e);
    } finally {
      setGenerating(false);
      setGeneratingId(null);
      setStreamStatus('');
      abortRef.current = null;
    }
  }

  async function generateOverview() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setOvStreaming(true);
    setOvStreamText('');
    setStreamStatus('organising');

    try {
      for await (const ev of api.guide.generateOverview(
        collection.id,
        chunk => setOvStreamText(t => t + chunk),
        status => setStreamStatus(status),
        ctrl.signal,
      )) {
        if (ev.done) {
          api.guide.getOverview(collection.id).then(ov => setOverview(ov));
          setOvStreamText('');
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') console.error(e);
    } finally {
      setOvStreaming(false);
      setStreamStatus('');
      abortRef.current = null;
    }
  }

  function stop() { abortRef.current?.abort(); }

  const pending   = sources.filter(s => !s.content);
  const allDone   = sources.length > 0 && pending.length === 0;
  const anyBusy   = generating || ovStreaming;
  const hasSome   = sources.some(s => s.content);

  return (
    <div className="guide-panel">
      {/* ── Toolbar ── */}
      <div className="guide-toolbar">
        <span className="guide-title-label">Collection Guide</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {!anyBusy && !allDone && (
            <button className="btn-p guide-gen-btn" onClick={generateAll}>
              {hasSome ? `Generate ${pending.length} remaining` : 'Generate Collection Guide'}
            </button>
          )}
          {!anyBusy && allDone && (
            <button className="btn-p guide-gen-btn" onClick={generateAll}>Regenerate all</button>
          )}
        </span>
      </div>

      {/* ── Empty state ── */}
      {sources.length === 0 && (
        <div className="guide-empty">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14,2 14,8 20,8"/>
          </svg>
          <p>Add and index sources first, then generate a Collection Guide to get per-source summaries and an overall overview.</p>
        </div>
      )}

      {/* ── Source cards ── */}
      {sources.map(src => {
        const isThis   = generatingId === src.id;
        const liveText = streamTexts[src.id];
        const display  = liveText ?? src.content;
        return (
          <div key={src.id} className={`guide-source-card${isThis ? ' guide-source-card--active' : ''}`}>
            <div className="guide-source-header">
              <span className="guide-source-name">{src.name}</span>
              {src.generated_at && !isThis && (
                <span className="guide-ts">{new Date(src.generated_at + 'Z').toLocaleDateString()}</span>
              )}
              {isThis ? (
                <>
                  <ThinkingIndicator status={streamStatus} />
                  <button className="btn-g guide-regen-btn guide-stop-btn" onClick={stop}>Stop</button>
                </>
              ) : !generating && (
                <button className="btn-g guide-regen-btn" onClick={() => regenerateSource(src)}>
                  {src.content ? 'Redo' : 'Generate'}
                </button>
              )}
            </div>
            {display ? (
              <div className="guide-source-body">
                <GuideMarkdown text={display} />
                {isThis && liveText && <span className="guide-cursor" />}
              </div>
            ) : !isThis ? (
              <div className="guide-source-empty">Not yet summarised</div>
            ) : null}
          </div>
        );
      })}

      {/* ── Collection Overview ── */}
      {sources.length > 0 && (
        <div className="guide-overview-section">
          <div className="guide-toolbar" style={{ borderTop: '1px solid var(--border-low)', paddingTop: 12 }}>
            <span className="guide-title-label">Collection Overview</span>
            <span style={{ marginLeft: 'auto' }}>
              {ovStreaming ? (
                <>
                  <ThinkingIndicator status={streamStatus} />
                  <button className="btn-g guide-regen-btn guide-stop-btn" onClick={stop}>Stop</button>
                </>
              ) : allDone ? (
                <button className="btn-p guide-gen-btn" onClick={generateOverview}>
                  {overview.content ? 'Regenerate Overview' : 'Generate Overview'}
                </button>
              ) : (
                <span className="guide-ts">Complete source summaries first</span>
              )}
            </span>
          </div>

          {ovStreaming && !ovStreamText && (
            <div className="guide-thinking"><ThinkingIndicator status={streamStatus} /></div>
          )}

          {(ovStreamText || overview.content) ? (
            <div className="guide-content">
              <GuideMarkdown text={ovStreamText || overview.content!} />
              {ovStreaming && ovStreamText && <span className="guide-cursor" />}
            </div>
          ) : !ovStreaming && allDone ? (
            <div className="guide-source-empty" style={{ padding: '12px 0' }}>
              Click "Generate Overview" to synthesise all source summaries into a single collection summary.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Thinking / status indicator ────────────────────────────────────────────

const STATUS_LABELS: Record<string, string> = {
  searching:   'Searching your sources',
  reading:     'Reading relevant passages',
  thinking:    'Thinking',
  organising:  'Organising the guide',
  organizing:  'Organising the guide',
};

const SLOW_MESSAGES = [
  'Still on it — big thoughts take time',
  'Digging deeper into your sources…',
  'Almost there, probably',
  'Your CPU is working very hard right now',
  'This one needs extra brain cells',
];

function ThinkingIndicator({ status }: { status: string }) {
  const [elapsed, setElapsed] = useState(0);
  const label = STATUS_LABELS[status] || 'Thinking';

  useEffect(() => {
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

  const slowMsg = elapsed >= 15 ? SLOW_MESSAGES[Math.floor(elapsed / 10) % SLOW_MESSAGES.length] : null;

  return (
    <span className="thinking-indicator">
      <span className="thinking-label">{slowMsg ?? label}</span>
      {elapsed >= 15 && (
        <span className="thinking-elapsed"> ({elapsed}s)</span>
      )}
      <span className="thinking-dots">
        <span /><span /><span />
      </span>
    </span>
  );
}

function GuideMarkdown({ text }: { text: string }) {
  // Minimal markdown: ## headings, **bold**, - bullets, blank-line paragraphs
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      elements.push(<h2 key={key++} className="g-h2">{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={key++} className="g-h3">{line.slice(4)}</h3>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={key++} className="g-li">{inlineFormat(line.slice(2))}</li>);
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<li key={key++} className="g-li g-oli">{inlineFormat(line.replace(/^\d+\.\s/, ''))}</li>);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="g-gap" />);
    } else {
      elements.push(<p key={key++} className="g-p">{inlineFormat(line)}</p>);
    }
  }
  return <>{elements}</>;
}

function inlineFormat(text: string): React.ReactNode {
  // Handle **bold**
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : p
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b < 1024)        return `${b} B`;
  if (b < 1048576)     return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

function iconBg(s: Source): string {
  const t = s.mime_type ?? '';
  if (t.includes('pdf'))   return 'rgba(224,123,107,.12)';
  if (t.includes('word') || t.includes('doc')) return 'rgba(91,191,176,.12)';
  if (t.includes('pres') || t.includes('ppt')) return 'rgba(232,184,75,.12)';
  if (t.includes('sheet') || t.includes('xls')) return 'rgba(94,200,122,.12)';
  if (t.startsWith('audio') || t.startsWith('video')) return 'rgba(139,127,232,.12)';
  return 'rgba(107,140,110,.12)';
}

function iconColor(s: Source): string {
  const t = s.mime_type ?? '';
  if (t.includes('pdf'))   return '#e07b6b';
  if (t.includes('word') || t.includes('doc')) return '#5bbfb0';
  if (t.includes('pres') || t.includes('ppt')) return '#e8b84b';
  if (t.includes('sheet') || t.includes('xls')) return '#5ec87a';
  if (t.startsWith('audio') || t.startsWith('video')) return '#8b7fe8';
  return '#6b8c6e';
}
