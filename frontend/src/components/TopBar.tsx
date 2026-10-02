import { Settings, Monitor, Sun, Moon } from 'lucide-react';
import type { Theme, Collection } from '../types';

function shortModel(m: string) {
  return m.replace(/:latest$/, '');
}

interface Props {
  brainName:       string;
  theme:           Theme;
  ollamaOk:        boolean;
  activeCol:       Collection | null;
  currentModel:    string;
  sidebarOpen:     boolean;
  onToggleSidebar: () => void;
  onTheme:         (t: Theme) => void;
  onRename:        () => void;
  onShortcuts:     () => void;
  onSettings:      () => void;
  onTour:          () => void;
  onGraph:         () => void;
}

export function TopBar({ brainName, theme, ollamaOk, activeCol, currentModel, sidebarOpen, onToggleSidebar, onTheme, onRename, onShortcuts, onSettings }: Props) {
  function cycleTheme() {
    if (theme === 'system') onTheme('light');
    else if (theme === 'light') onTheme('dark');
    else onTheme('system');
  }

  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;

  return (
    <div className="topbar">
      {/* Sidebar toggle */}
      <button className="topbar-sidebar-toggle" onClick={onToggleSidebar} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
        <svg viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="1" y="1" width="14" height="10" rx="2"/>
          <path d="M5 1v10"/>
        </svg>
      </button>

      <div className="topbar-drag">
        <div className="topbar-logo">
          <div className="logo-mark">
            <svg width="28" height="28" viewBox="0 0 30 30" fill="none">
              <circle cx="15" cy="15" r="15" fill="#2563eb"/>
              <path d="M15 7v16M7 15h16M11.2 11.2l7.6 7.6M18.8 11.2l-7.6 7.6" stroke="white" strokeWidth="2.4" strokeLinecap="round"/>
            </svg>
          </div>
          <span className="topbar-name">{brainName || 'Jade'}</span>
        </div>

        {activeCol ? (
          <div className="topbar-breadcrumb">
            <div className="topbar-sep-line" />
            <span className="col-dot" style={{ background: activeCol.color, width: 7, height: 7, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
            <span className="topbar-col-name">{activeCol.name}</span>
          </div>
        ) : (
          <div className="topbar-brain">
            <span>your second brain</span>
            <button onClick={onRename} title="Rename">
              <svg width="10" height="10" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5z"/>
              </svg>
            </button>
          </div>
        )}
      </div>

      <div className="topbar-right">
        {currentModel && (
          <div className="status-pill">
            <div className={`s-dot${ollamaOk ? '' : ' offline'}`} />
            <span>{shortModel(currentModel)}</span>
          </div>
        )}
        {!currentModel && (
          <div className="status-pill">
            <div className={`s-dot${ollamaOk ? '' : ' offline'}`} />
            <span>{ollamaOk ? 'online' : 'offline'}</span>
          </div>
        )}

        <button className="topbar-btn" onClick={cycleTheme} title={`Theme: ${theme}`}>
          <ThemeIcon size={13} />
        </button>
        <button className="topbar-btn" onClick={onShortcuts} title="Keyboard shortcuts">
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="1" width="12" height="12" rx="2"/>
            <path d="M4 9V7.5a1.5 1.5 0 013 0v0a1.5 1.5 0 003 0V5M7 9h.01"/>
          </svg>
        </button>
        <button className="topbar-btn" onClick={onSettings} title="Settings">
          <Settings size={13} />
        </button>
      </div>
    </div>
  );
}
