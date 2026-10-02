import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api';
import type { Collection, Source, Theme, ActiveTab, AppSettings } from './types';
import { TopBar } from './components/TopBar';
import { SearchOverlay, ShortcutsOverlay, RenameOverlay, NewCollectionOverlay, ConfirmOverlay, StartupScreen, OnboardingTour } from './components/Overlays';
import { SettingsPanel } from './components/SettingsPanel';
import { Home } from './views/Home';
import { CollectionView } from './views/Collection';

export default function App() {
  const [collections, setCols]    = useState<Collection[]>([]);
  const [activeCol, setActiveCol] = useState<Collection | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('chat');
  const [brainName, setBrainName] = useState('');
  const [settings, setSettings]   = useState<AppSettings | null>(null);
  const [ollamaOk, setOllamaOk]   = useState(false);
  const [theme, setThemeState]    = useState<Theme>('system');

  type Bookmark = { question: string; collName: string; collColor: string; collId: string };
  const [bookmarks, setBookmarks]     = useState<Record<string, Bookmark>>(() => {
    try { return JSON.parse(localStorage.getItem('jade-bookmarks') || '{}'); } catch { return {}; }
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedColId, setExpandedColId] = useState<string | null>(null);
  const [sourcesByCol, setSourcesByCol]   = useState<Record<string, Source[]>>({});

  const [showStartup,   setShowStartup]   = useState(!window.electron);
  const [showOnboarding,setShowOnboarding]= useState(() => {
    try { return !localStorage.getItem('jade_onboarded'); } catch { return false; }
  });
  const [showSearch,    setShowSearch]    = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showRename,    setShowRename]    = useState(false);
  const [showNewCol,    setShowNewCol]    = useState(false);
  const [showSettings,  setShowSettings]  = useState(false);

  // Collection rename
  const [renamingCol,    setRenamingCol]    = useState<Collection | null>(null);
  const [renameColVal,   setRenameColVal]   = useState('');
  const [showRenameCol,  setShowRenameCol]  = useState(false);

  // Collection delete confirm
  const [confirmDelete,    setConfirmDelete]    = useState(false);
  const [pendingDeleteCol, setPendingDeleteCol] = useState<Collection | null>(null);

  const loadCollections = useCallback(() => {
    api.collections.list().then(setCols).catch(console.error);
  }, []);

  const prevOllamaOk = useRef(false);

  useEffect(() => {
    loadCollections();
    api.settings.get().then(s => { setSettings(s); setBrainName(s.brain_name || 'Jade'); }).catch(() => setBrainName('Jade'));
    api.health().then(h => setOllamaOk(h.ollama)).catch(() => setOllamaOk(false));
    const t = setInterval(() => api.health().then(h => setOllamaOk(h.ollama)).catch(() => setOllamaOk(false)), 15000);
    // Sync titlebar overlay color with initial theme on first render
    window.electron?.updateTitlebarTheme('system');
    return () => clearInterval(t);
  }, [loadCollections]);

  // Reload collections whenever Ollama transitions from offline → online (backend recovery)
  useEffect(() => {
    if (ollamaOk && !prevOllamaOk.current) loadCollections();
    prevOllamaOk.current = ollamaOk;
  }, [ollamaOk, loadCollections]);

  // Keep bookmarks in sync with localStorage updates from ChatTab
  useEffect(() => {
    const sync = () => {
      try { setBookmarks(JSON.parse(localStorage.getItem('jade-bookmarks') || '{}')); } catch {}
    };
    window.addEventListener('jade-bookmarks-updated', sync);
    return () => window.removeEventListener('jade-bookmarks-updated', sync);
  }, []);

  function setTheme(t: Theme) {
    setThemeState(t);
    const root = document.documentElement;
    if (t === 'dark')       root.setAttribute('data-theme', 'dark');
    else if (t === 'light') root.setAttribute('data-theme', 'light');
    else                    root.removeAttribute('data-theme');
    window.electron?.updateTitlebarTheme(t);
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'k') { e.preventDefault(); setShowSearch(true); return; }
      if (mod && e.key === 'n') { e.preventDefault(); setShowNewCol(true); return; }
      if (mod && e.key === '1') { e.preventDefault(); setActiveTab('sources'); return; }
      if (mod && e.key === '2') { e.preventDefault(); setActiveTab('chat'); return; }
      if (mod && e.key === '3') { e.preventDefault(); setActiveTab('guide'); return; }
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '?' && !mod && tag !== 'INPUT' && tag !== 'TEXTAREA') setShowShortcuts(true);
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  async function createCollection(name: string) {
    const col = await api.collections.create(name);
    loadCollections();
    setActiveCol(col);
    setActiveTab('sources');
    setShowNewCol(false);
  }

  async function saveBrainName(name: string) {
    const s = await api.settings.save(name);
    setBrainName(s.brain_name);
    setShowRename(false);
  }

  function openCollection(c: Collection) {
    setActiveCol(c);
    setActiveTab('chat');
  }

  function goHome() {
    setActiveCol(null);
    loadCollections();
  }

  function deleteCollection(id: string) {
    if (activeCol?.id === id) setActiveCol(null);
    loadCollections();
  }

  function openCollectionById(id: string) {
    const col = collections.find(c => c.id === id);
    if (col) openCollection(col);
  }

  function startRenameCol(c: Collection, e?: React.MouseEvent) {
    e?.stopPropagation();
    setRenamingCol(c);
    setRenameColVal(c.name);
    setShowRenameCol(true);
  }

  async function saveRenameCol() {
    if (!renamingCol || !renameColVal.trim()) return;
    const updated = await api.collections.update(renamingCol.id, { name: renameColVal.trim() });
    loadCollections();
    if (activeCol?.id === renamingCol.id) setActiveCol(updated);
    setShowRenameCol(false);
    setRenamingCol(null);
  }

  function requestDeleteCol(c: Collection, e?: React.MouseEvent) {
    e?.stopPropagation();
    setPendingDeleteCol(c);
    setConfirmDelete(true);
  }

  async function confirmDeleteCol() {
    if (!pendingDeleteCol) return;
    await api.collections.delete(pendingDeleteCol.id).catch(console.error);
    deleteCollection(pendingDeleteCol.id);
    setConfirmDelete(false);
    setPendingDeleteCol(null);
  }

  return (
    <>
      {showStartup && (
        <StartupScreen
          brainName={brainName}
          onDone={() => {
            setShowStartup(false);
            // Show onboarding after startup clears (only for new users)
          }}
        />
      )}
      {!showStartup && showOnboarding && (
        <OnboardingTour brainName={brainName} onDone={() => setShowOnboarding(false)} />
      )}
      <div className="app">
        <TopBar
          brainName={brainName}
          theme={theme}
          ollamaOk={ollamaOk}
          activeCol={activeCol}
          currentModel={settings?.model_config?.llm ?? ''}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(o => !o)}
          onTheme={setTheme}
          onRename={() => setShowRename(true)}
          onShortcuts={() => setShowShortcuts(true)}
          onSettings={() => setShowSettings(true)}
          onTour={() => setShowOnboarding(true)}
          onGraph={() => {
            if (activeCol) setActiveTab('connections');
            else if (collections.length > 0) { setActiveCol(collections[0]); setActiveTab('connections'); }
          }}
        />

        <div className="body">
          <aside className={`sidebar${sidebarOpen ? '' : ' sidebar--collapsed'}`}>
            <div className="sidebar-search">
              <button className="search-trigger" onClick={() => setShowSearch(true)}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                  <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="m9 9 3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Search collections...
                <kbd>K</kbd>
              </button>
            </div>
            <div className="sidebar-scroll">
              <div className="s-label">Collections</div>
              {collections.map(c => {
                const isExpanded = expandedColId === c.id;
                const sources    = sourcesByCol[c.id] ?? [];
                return (
                  <div key={c.id}>
                    <div className={`col-item${activeCol?.id === c.id ? ' active' : ''}`}>
                      <button
                        className="col-expand"
                        title={isExpanded ? 'Collapse' : 'Expand sources'}
                        onClick={e => {
                          e.stopPropagation();
                          if (isExpanded) {
                            setExpandedColId(null);
                          } else {
                            setExpandedColId(c.id);
                            if (!sourcesByCol[c.id]) {
                              api.sources.list(c.id).then(srcs => setSourcesByCol(prev => ({ ...prev, [c.id]: srcs }))).catch(() => {});
                            }
                          }
                        }}
                      >
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
                          <path d="M2 1l4 3-4 3"/>
                        </svg>
                      </button>
                      <span className="col-dot" style={{ background: c.color }} onClick={() => openCollection(c)} />
                      <span className="col-label" onClick={() => openCollection(c)}>{c.name}</span>
                      <span className="col-n">{c.source_count}</span>
                      <div className="col-actions" onClick={e => e.stopPropagation()}>
                        <button className="col-action" title="Rename" onClick={e => startRenameCol(c, e)}>
                          <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                            <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5zM8.5 3.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                        <button className="col-action danger" title="Delete" onClick={e => requestDeleteCol(c, e)}>
                          <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                            <path d="M2 3.5h10M5.5 3.5V2.5h3v1M6 6v4M8 6v4M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    {isExpanded && (
                      <div className="col-sources">
                        {sources.length === 0 && <div className="col-src-empty">No sources yet</div>}
                        {sources.map(s => (
                          <div key={s.id} className="col-src-item" title={s.name} onClick={() => openCollection(c)}>
                            <span className="col-src-bullet">·</span>
                            <span className="col-src-name">{s.name.length > 26 ? s.name.slice(0, 24) + '…' : s.name}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {collections.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-3)', padding: '8px 6px' }}>
                  No collections yet.
                </div>
              )}

              {/* New collection — inside scroll area, right after collections */}
              <button className="new-col-btn" onClick={() => setShowNewCol(true)}>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                New collection
              </button>

              <div className="sb-divider" />

              {/* Bookmarks — always visible */}
              <div className="s-label">Bookmarks</div>
              {Object.keys(bookmarks).length === 0 ? (
                <div className="bm-empty">No bookmarks yet — hover a reply to save it.</div>
              ) : (
                Object.entries(bookmarks).map(([id, bm]) => (
                  <div key={id} className="bm-item" onClick={() => openCollectionById(bm.collId)}>
                    <div className="bm-icon-wrap">
                      <svg viewBox="0 0 12 14" width="12" height="12" fill="currentColor">
                        <path d="M2 1h8a1 1 0 011 1v11l-5-3-5 3V2a1 1 0 011-1z"/>
                      </svg>
                    </div>
                    <div className="bm-item-left">
                      <div className="bm-coll-row">
                        <span className="bm-dot" style={{ background: bm.collColor }} />
                        <span className="bm-coll-name">{bm.collName}</span>
                        <button className="bm-remove" title="Remove bookmark" onClick={e => {
                          e.stopPropagation();
                          const next = { ...bookmarks };
                          delete next[id];
                          setBookmarks(next);
                          try { localStorage.setItem('jade-bookmarks', JSON.stringify(next)); } catch {}
                          window.dispatchEvent(new Event('jade-bookmarks-updated'));
                        }}>×</button>
                      </div>
                      <div className="bm-question">{bm.question}</div>
                    </div>
                  </div>
                ))
              )}

              <div className="sb-divider" />

              {/* Knowledge connections nav item */}
              <button className="kg-sidebar-btn" onClick={() => {
                if (activeCol) {
                  setActiveTab('connections');
                } else if (collections.length > 0) {
                  setActiveCol(collections[0]);
                  setActiveTab('connections');
                }
              }}>
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <circle cx="7" cy="7" r="1.8"/>
                  <circle cx="2" cy="3" r="1.3"/><circle cx="12" cy="3" r="1.3"/>
                  <circle cx="2" cy="11" r="1.3"/><circle cx="12" cy="11" r="1.3"/>
                  <path d="M3.1 3.8L5.4 5.8M10.9 3.8L8.6 5.8M3.1 10.2L5.4 8.2M10.9 10.2L8.6 8.2"/>
                </svg>
                Knowledge connections
              </button>
            </div>
          </aside>

          <main className="main">
            {activeCol ? (
              <CollectionView
                key={activeCol.id}
                collection={activeCol}
                brainName={brainName}
                activeTab={activeTab}
                onTab={setActiveTab}
                onBack={goHome}
                onDelete={c => requestDeleteCol(c)}
                onRename={c => startRenameCol(c)}
                onOpenCollection={openCollectionById}
              />
            ) : (
              <Home
                collections={collections}
                brainName={brainName}
                onOpen={openCollection}
                onNew={() => setShowNewCol(true)}
                onDelete={c => requestDeleteCol(c)}
                onRename={startRenameCol}
              />
            )}
          </main>
        </div>
      </div>

      <SearchOverlay    open={showSearch}    onClose={() => setShowSearch(false)}    onSelect={openCollectionById} />
      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      <RenameOverlay    open={showRename}    current={brainName} onSave={saveBrainName} onClose={() => setShowRename(false)} />
      <NewCollectionOverlay open={showNewCol} onCreate={createCollection} onClose={() => setShowNewCol(false)} />

      <SettingsPanel
        open={showSettings}
        brainName={brainName}
        currentModel={settings?.model_config?.llm ?? ''}
        onClose={() => setShowSettings(false)}
        onSave={(name, model) => {
          setBrainName(name);
          setSettings(s => s ? { ...s, brain_name: name, model_config: { ...s.model_config, llm: model } } : s);
          setShowSettings(false);
        }}
      />

      <ConfirmOverlay
        open={confirmDelete}
        message={`Delete "${pendingDeleteCol?.name}" and all its sources? This cannot be undone.`}
        danger="Delete"
        onConfirm={confirmDeleteCol}
        onCancel={() => { setConfirmDelete(false); setPendingDeleteCol(null); }}
      />

      {/* Rename collection modal */}
      {showRenameCol && (
        <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && setShowRenameCol(false)}>
          <div className="modal">
            <h3>Rename collection</h3>
            <input
              className="url-input" maxLength={80} autoFocus
              value={renameColVal} onChange={e => setRenameColVal(e.target.value)}
              placeholder="Collection name…"
              onKeyDown={e => { if (e.key === 'Enter') saveRenameCol(); if (e.key === 'Escape') setShowRenameCol(false); }}
            />
            <div className="modal-actions">
              <button className="btn-g" onClick={() => setShowRenameCol(false)}>Cancel</button>
              <button className="btn-p" disabled={!renameColVal.trim()} onClick={saveRenameCol}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
