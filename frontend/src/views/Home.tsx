import type { Collection } from '../types';

interface Props {
  collections: Collection[];
  brainName:   string;
  onOpen:      (c: Collection) => void;
  onNew:       () => void;
  onDelete:    (c: Collection) => void;
  onRename:    (c: Collection, e?: React.MouseEvent) => void;
}

export function Home({ collections, brainName, onOpen, onNew, onDelete, onRename }: Props) {
  function handleDelete(e: React.MouseEvent, c: Collection) {
    e.stopPropagation();
    onDelete(c);
  }
  return (
    <>
      <div className="home-header">
        <div className="home-title">{brainName} — your second brain</div>
        <div className="home-sub">Select a collection, or search (Ctrl+K) to find where your material lives.</div>
      </div>
      <div className="home-body">
        <div className="grid-meta">{collections.length} collection{collections.length !== 1 ? 's' : ''}</div>
        <div className="grid">
          {collections.map(c => (
            <div className="card" key={c.id} onClick={() => onOpen(c)}>
              <div className="card-bar" style={{ background: c.color }} />
              <div className="card-inner">
                <div className="card-title">{c.name}</div>
                <div className="card-row">
                  <span className="c-meta">{c.source_count} source{c.source_count !== 1 ? 's' : ''}</span>
                  <span className="c-meta" style={{ marginLeft: 'auto' }}>{formatDate(c.updated_at)}</span>
                  <button className="card-icon-btn" onClick={e => { e.stopPropagation(); onRename(c, e); }} title="Rename">
                    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                      <path d="M9.5 2.5l2 2L4 12H2v-2L9.5 2.5zM8.5 3.5l2 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  <button className="card-icon-btn danger" onClick={e => handleDelete(e, c)} title="Delete">
                    <svg width="10" height="10" viewBox="0 0 14 14" fill="none">
                      <path d="M2 3.5h10M5.5 3.5V2.5h3v1M6 6v4M8 6v4M3 3.5l.7 8h6.6l.7-8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
          <div className="card card-new" onClick={onNew}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
            <span>New collection</span>
          </div>
        </div>
      </div>
    </>
  );
}

function formatDate(iso: string): string {
  const d    = new Date(iso + 'Z');
  const now  = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 86400)   return 'today';
  if (diff < 172800)  return 'yesterday';
  if (diff < 604800)  return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
