import React, { useEffect, useRef, useState } from 'react';
import { Brain, FolderOpen, FileText, MessageSquare, BookOpen } from 'lucide-react';
import { api } from '../api';
import type { SearchResult } from '../types';


// ── Startup Screen ─────────────────────────────────────────────────────────

type CheckState = 'waiting' | 'ready' | 'error';

interface StartupScreenProps {
  brainName: string;
  onDone: () => void;
}


const LOADING_MESSAGES = [
  'Loading AI model…',
  'Warming up the engine…',
  'This can take a minute…',
  'Almost there…',
  'Getting your brain ready…',
  'Still working on it…',
];

export function StartupScreen({ brainName, onDone }: StartupScreenProps) {
  const [backend, setBackend] = useState<CheckState>('waiting');
  const [ollama,  setOllama]  = useState<CheckState>('waiting');
  const [showSkip, setShowSkip] = useState(false);
  const [msgIdx, setMsgIdx] = useState(0);

  // Real progress: 0 while waiting, 85 once backend is up (Ollama still loading), 100 when ready
  const backendProgress = backend === 'ready' ? 100 : 0;
  const ollamaProgress  = ollama  === 'ready' ? 100 : backend === 'ready' ? 85 : 0;

  useEffect(() => {
    let errorTimer: ReturnType<typeof setTimeout>;

    const interval = setInterval(async () => {
      try {
        const h = await api.health();
        setBackend('ready');
        setOllama(h.ollama ? 'ready' : 'waiting');
        if (h.ollama) {
          clearInterval(interval);
          clearTimeout(errorTimer);
          setTimeout(onDone, 800);
        }
      } catch {
        setBackend(b => b === 'ready' ? 'ready' : 'waiting');
        setOllama(o => o === 'ready' ? 'ready' : 'waiting');
      }
    }, 1500);

    const skipTimer = setTimeout(() => setShowSkip(true), 8000);
    // Auto-advance after 30s at 85% — Ollama GPU discovery can take ~90s on some GPUs;
    // the model keeps loading in the background and chat shows the "warming up" message.
    const autoSkipTimer = setTimeout(() => {
      clearInterval(interval);
      clearTimeout(errorTimer);
      onDone();
    }, 30_000);
    // After 120s with no response, surface an error rather than spinning forever
    errorTimer = setTimeout(() => {
      setBackend(b => b === 'waiting' ? 'error' : b);
      setOllama(o => o === 'waiting' ? 'error' : o);
    }, 120_000);
    const msgTimer = setInterval(() => setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length), 4000);

    return () => { clearInterval(interval); clearTimeout(skipTimer); clearTimeout(autoSkipTimer); clearTimeout(errorTimer); clearInterval(msgTimer); };
  }, [onDone]);

  function Check({ state, label, progress }: { state: CheckState; label: string; progress: number }) {
    return (
      <div className={`startup-check ${state}`}>
        <div className="sc-header">
          <span className="sc-icon">
            {state === 'ready'   && <svg viewBox="0 0 16 16" fill="none"><path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
            {state === 'waiting' && <span className="sc-spin" />}
            {state === 'error'   && <svg viewBox="0 0 16 16" fill="none"><path d="M8 5v4M8 11v.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>}
          </span>
          <span className="sc-label">{label}</span>
          <span className="sc-pct">{state === 'ready' ? '100%' : `${Math.round(progress)}%`}</span>
        </div>
        <div className="sc-bar-track">
          <div
            className={`sc-bar-fill${state === 'ready' ? ' done' : ''}`}
            style={{ width: `${state === 'ready' ? 100 : progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="startup-screen">
      <div className="startup-logo-jade">
        <svg width="80" height="80" viewBox="0 0 30 30" fill="none">
          <circle cx="15" cy="15" r="15" fill="#2563eb"/>
          <path d="M15 7v16M7 15h16M11.2 11.2l7.6 7.6M18.8 11.2l-7.6 7.6" stroke="white" strokeWidth="2.4" strokeLinecap="round"/>
        </svg>
      </div>
      <div className="startup-name">{brainName || 'Jade'}</div>
      <div className="startup-tagline">your offline second brain</div>
      <div className="startup-checks">
        <Check state={backend} label="Core services" progress={backendProgress} />
        <Check state={ollama}  label="AI ready"      progress={ollamaProgress}  />
      </div>
      {(backend === 'waiting' || ollama === 'waiting') && backend !== 'error' && ollama !== 'error' && (
        <p className="startup-status-msg">{LOADING_MESSAGES[msgIdx]}</p>
      )}
      {(backend === 'error' || ollama === 'error') && (
        <p className="startup-status-msg" style={{ color: 'var(--red, #f85149)' }}>
          Something took too long to start. Close and reopen Jade, or check launcher.log for details.
        </p>
      )}
      {showSkip && (
        <>
          <button className="startup-skip" onClick={onDone}>Skip and continue anyway</button>
          {ollama !== 'ready' && (
            <p className="startup-note">
              The AI engine isn't running yet. Chat will work once it finishes loading.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Onboarding Tour ────────────────────────────────────────────────────────

interface TourStep {
  Icon: React.ElementType;
  title: string;
  body: string;
}

const TOUR_STEPS: TourStep[] = [
  {
    Icon: Brain,
    title: 'Welcome to your second brain',
    body: 'This is your private, offline AI assistant. Everything runs on your machine — no cloud, no data leaving your device. Ask questions, get answers grounded in your own study material.',
  },
  {
    Icon: FolderOpen,
    title: 'Collections',
    body: 'Organise your material into Collections — one per course, project, or topic. Each collection has its own sources and chat history. Create one from the sidebar or the home screen.',
  },
  {
    Icon: FileText,
    title: 'Sources',
    body: 'Add PDFs, Word docs, PowerPoints, spreadsheets, web links, audio, and video files. The AI reads and indexes everything so it can answer questions from your actual content.',
  },
  {
    Icon: MessageSquare,
    title: 'Chat',
    body: "Ask anything in a collection's Chat tab. The AI searches your sources and answers using only what's in there — no hallucinated facts. If it doesn't know, it'll say so.",
  },
  {
    Icon: BookOpen,
    title: 'Collection Guide',
    body: 'The Collection Guide tab auto-generates per-source summaries and an overall overview of your collection. Great for revision — hit "Generate Collection Guide" to get started.',
  },
];

interface OnboardingTourProps {
  brainName: string;
  onDone: () => void;
}

export function OnboardingTour({ brainName, onDone }: OnboardingTourProps) {
  const [step, setStep] = useState(0);
  const total = TOUR_STEPS.length;
  const { Icon, title, body } = TOUR_STEPS[step];
  const isLast = step === total - 1;

  function finish() {
    try { localStorage.setItem('jade_onboarded', '1'); } catch {}
    onDone();
  }

  return (
    <div className="tour-overlay">
      <div className="tour-card">
        <button className="tour-close" onClick={finish} title="Close">✕</button>
        <div className="tour-step-dots">
          {TOUR_STEPS.map((_, i) => (
            <div key={i} className={`tour-dot${i === step ? ' active' : ''}`} />
          ))}
        </div>
        <div className="tour-icon"><Icon size={28} strokeWidth={1.4} color="var(--accent)" /></div>
        <div className="tour-title">{title.replace('your second brain', brainName + ' — your second brain')}</div>
        <div className="tour-body">{body}</div>
        <div className="tour-actions">
          <button className="tour-skip" onClick={finish}>Skip tour</button>
          <div className="tour-nav">
            {step > 0 && (
              <button className="btn-g" onClick={() => setStep(s => s - 1)}>Back</button>
            )}
            {isLast ? (
              <button className="btn-p" onClick={finish}>Let's go →</button>
            ) : (
              <button className="btn-p" onClick={() => setStep(s => s + 1)}>Next →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Confirm dialog ─────────────────────────────────────────────────────────

interface ConfirmProps {
  open:     boolean;
  message:  string;
  danger?:  string;   // label for the confirm button (default "Delete")
  onConfirm: () => void;
  onCancel:  () => void;
}

export function ConfirmOverlay({ open, message, danger = 'Delete', onConfirm, onCancel }: ConfirmProps) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onCancel]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 380 }}>
        <p style={{ marginBottom: 24, color: 'var(--text-1)', lineHeight: 1.6 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn-g" onClick={onCancel}>Cancel</button>
          <button
            style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}
            onClick={onConfirm}
          >{danger}</button>
        </div>
      </div>
    </div>
  );
}

// ── Shortcuts ──────────────────────────────────────────────────────────────

interface ShortcutsProps { open: boolean; onClose: () => void; }

export function ShortcutsOverlay({ open, onClose }: ShortcutsProps) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 460 }}>
        <h3>Keyboard shortcuts</h3>
        <div style={{ marginTop: 16 }}>
          {[
            { label: 'Navigation', rows: [
              ['Search all collections', ['Ctrl', 'K']],
              ['New collection',        ['Ctrl', 'N']],
              ['Sources tab',           ['Ctrl', '1']],
              ['Chat tab',              ['Ctrl', '2']],
              ['Notebook Guide',        ['Ctrl', '3']],
            ]},
            { label: 'Actions', rows: [
              ['Add files',             ['Ctrl', 'U']],
              ['Generate guide',        ['Ctrl', 'G']],
              ['Focus chat input',      ['Ctrl', 'L']],
              ['Show shortcuts',        ['?']],
            ]},
          ].map(group => (
            <div className="sh-group" key={group.label}>
              <div className="sh-g-label">{group.label}</div>
              {group.rows.map(([action, keys]) => (
                <div className="sh-row" key={action as string}>
                  <span className="sh-action">{action as string}</span>
                  <div className="sh-keys">
                    {(keys as string[]).map(k => <kbd key={k}>{k}</kbd>)}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn-g" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ── Brain rename ───────────────────────────────────────────────────────────

interface RenameProps { open: boolean; current: string; onSave: (name: string) => void; onClose: () => void; }

export function RenameOverlay({ open, current, onSave, onClose }: RenameProps) {
  const [val, setVal] = useState(current);
  useEffect(() => { if (open) setVal(current); }, [open, current]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>Name your second brain</h3>
        <p>Give it a name you'll remember. It's yours — call it anything.</p>
        <input
          className="url-input" maxLength={32}
          value={val} onChange={e => setVal(e.target.value)}
          placeholder="e.g. Jade, Atlas, Mira…"
          onKeyDown={e => { if (e.key === 'Enter') onSave(val.trim() || 'Jade'); }}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-g" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={() => onSave(val.trim() || 'Jade')}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── New collection ─────────────────────────────────────────────────────────

interface NewColProps { open: boolean; onCreate: (name: string) => void; onClose: () => void; }

export function NewCollectionOverlay({ open, onCreate, onClose }: NewColProps) {
  const [val, setVal] = useState('');
  useEffect(() => { if (open) setVal(''); }, [open]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);

  return (
    <div className={`modal-overlay${open ? ' open' : ''}`} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h3>New collection</h3>
        <p>Name this collection — a course, book, project, or any topic you want to keep together.</p>
        <input
          className="url-input" maxLength={80}
          value={val} onChange={e => setVal(e.target.value)}
          placeholder="e.g. COMP3100, Thinking Fast and Slow…"
          onKeyDown={e => { if (e.key === 'Enter' && val.trim()) onCreate(val.trim()); }}
          autoFocus
        />
        <div className="modal-actions">
          <button className="btn-g" onClick={onClose}>Cancel</button>
          <button className="btn-p" disabled={!val.trim()} onClick={() => onCreate(val.trim())}>Create</button>
        </div>
      </div>
    </div>
  );
}

// ── Global search ──────────────────────────────────────────────────────────

interface SearchProps {
  open: boolean;
  onClose: () => void;
  onSelect: (collectionId: string) => void;
}

export function SearchOverlay({ open, onClose, onSelect }: SearchProps) {
  const [q, setQ]           = useState('');
  const [results, setRes]   = useState<SearchResult[]>([]);
  const [sel, setSel]       = useState(0);
  const inputRef            = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setQ(''); setRes([]); setSel(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') setSel(s => Math.min(s + 1, results.length - 1));
      if (e.key === 'ArrowUp')   setSel(s => Math.max(s - 1, 0));
      if (e.key === 'Enter' && results[sel]) { onSelect(results[sel].collection_id); onClose(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, results, sel, onClose, onSelect]);

  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    const t = setTimeout(() => {
      api.search(q).then(r => { setRes(r); setSel(0); }).catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className={`overlay${open ? ' open' : ''}`} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="search-modal">
        <div className="search-top">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" style={{ color: 'var(--text-3)', flexShrink: 0 }}>
            <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4"/>
            <path d="m9 9 3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search across all collections…" />
          <span style={{ fontSize: 10, color: 'var(--text-3)' }}>ESC</span>
        </div>
        <div className="search-body">
          {results.length > 0 ? (
            <>
              <div className="sg-label">Collections with matches</div>
              {results.map((r, i) => (
                <div
                  key={r.collection_id}
                  className={`si${i === sel ? ' sel' : ''}`}
                  onClick={() => { onSelect(r.collection_id); onClose(); }}
                >
                  <span className="si-dot" style={{ background: r.collection_color }} />
                  <div className="si-info">
                    <div className="si-title">{r.collection_name}</div>
                    <div className="si-sub">…{r.snippet}…</div>
                  </div>
                  <span className="si-count">{r.match_count} matches</span>
                </div>
              ))}
            </>
          ) : q.trim() ? (
            <div style={{ padding: '14px 10px', color: 'var(--text-3)', fontSize: 12 }}>No matches found.</div>
          ) : (
            <div style={{ padding: '14px 10px', color: 'var(--text-3)', fontSize: 12 }}>Type to search across all collections.</div>
          )}
        </div>
        <div className="search-foot">
          <span className="hint"><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span className="hint"><kbd>↵</kbd> open collection</span>
          <span className="hint"><kbd>ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
