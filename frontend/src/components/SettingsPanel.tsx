import { useEffect, useState } from 'react';

interface Model {
  name: string;
  size: number;
  details: { parameter_size: string; family: string };
}

const ALLOWED_MODELS = ['qwen2.5:7b', 'gemma2:2b'];

const MODEL_LABELS: Record<string, string> = {
  'qwen2.5:7b': 'Fast',
  'gemma2:2b':  'Lightweight',
};

const MODEL_DESCRIPTIONS: Record<string, string> = {
  'qwen2.5:7b': 'Best for complex questions — requires 6 GB VRAM',
  'gemma2:2b':  'Fast and efficient — fits in 4 GB VRAM, great for most tasks',
};

function shortName(name: string) {
  return name.replace(/:latest$/, '');
}

interface Props {
  open:         boolean;
  brainName:    string;
  currentModel: string;
  onClose:      () => void;
  onSave:       (brainName: string, model: string) => void;
}

const TIER_MODEL: Record<string, string> = {
  high: 'qwen2.5:7b',
  low:  'gemma2:2b',
};

type Palette = 'jade' | 'clean';
type Scheme  = 'system' | 'light' | 'dark';

function applyAppearance(palette: Palette, scheme: Scheme) {
  const root = document.documentElement;
  if (palette === 'clean') root.setAttribute('data-palette', 'clean');
  else root.removeAttribute('data-palette');

  if (scheme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', scheme);

  localStorage.setItem('jade-palette', palette);
  localStorage.setItem('jade-scheme', scheme);
}

export function SettingsPanel({ open, brainName, currentModel, onClose, onSave }: Props) {
  const [name,        setName]        = useState(brainName);
  const [models,      setModels]      = useState<Model[]>([]);
  const [selected,    setSelected]    = useState(currentModel);
  const [hwModel,     setHwModel]     = useState('qwen2.5:7b');
  const [saving,      setSaving]      = useState(false);
  const [sourcesDir,  setSourcesDir]  = useState<string>('');
  const [changingDir, setChangingDir] = useState(false);
  const [palette,     setPalette]     = useState<Palette>(
    () => (localStorage.getItem('jade-palette') as Palette) ?? 'jade'
  );
  const [scheme,      setScheme]      = useState<Scheme>(
    () => (localStorage.getItem('jade-scheme') as Scheme) ?? 'system'
  );

  function handlePalette(p: Palette) { setPalette(p); applyAppearance(p, scheme); }
  function handleScheme(s: Scheme)   { setScheme(s);  applyAppearance(palette, s); }

  useEffect(() => { setName(brainName); }, [brainName]);

  useEffect(() => {
    if (!open) return;

    // Fetch hardware-detected model from settings
    fetch('/api/settings')
      .then(r => r.json())
      .then(s => {
        const tier = s.model_config?.tier ?? 'high';
        const hw   = TIER_MODEL[tier] ?? 'qwen2.5:7b';
        setHwModel(hw);
        // Auto-select the hw-recommended model unless currentModel is a known allowed model
        const resolvedCurrent = ALLOWED_MODELS.includes(shortName(currentModel)) || ALLOWED_MODELS.includes(currentModel)
          ? currentModel
          : hw;
        setSelected(resolvedCurrent);
      })
      .catch(() => setSelected(currentModel));

    // Fetch current sources folder from config endpoint
    fetch('/api/config')
      .then(r => r.json())
      .then(c => setSourcesDir(c.sources_dir ?? ''))
      .catch(() => {});

    fetch('/api/models')
      .then(r => r.json())
      .then(d => {
        fetch('http://localhost:11434/api/tags')
          .then(r => r.json())
          .then(tags => {
            const tagMap: Record<string, Model> = {};
            (tags.models ?? []).forEach((m: Model) => { tagMap[m.name] = m; });
            const enriched = (d.available ?? [])
              .filter((n: string) => ALLOWED_MODELS.includes(shortName(n)) || ALLOWED_MODELS.includes(n))
              .map((n: string) => tagMap[n] ?? { name: n, size: 0, details: { parameter_size: '', family: '' } });
            setModels(enriched);
          })
          .catch(() => setModels((d.available ?? []).filter((n: string) => ALLOWED_MODELS.includes(shortName(n)) || ALLOWED_MODELS.includes(n)).map((n: string) => ({ name: n, size: 0, details: { parameter_size: '', family: '' } }))));
      })
      .catch(() => {});
  }, [open]);

  async function handleChangeDir() {
    if (!window.electron?.changeSourcesDir) return;
    setChangingDir(true);
    try {
      const newDir = await window.electron.changeSourcesDir();
      if (newDir) setSourcesDir(newDir);
    } finally {
      setChangingDir(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brain_name: name.trim() || 'Jade', llm_model: selected }),
      });
      onSave(name.trim() || 'Jade', selected);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <aside className="settings-panel">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-body">
          {/* Appearance */}
          <section className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>

            <label className="settings-label">Theme</label>
            <div className="appearance-row">
              {(['jade', 'clean'] as Palette[]).map(p => (
                <button key={p}
                  className={`appearance-btn${palette === p ? ' appearance-btn--active' : ''}`}
                  onClick={() => handlePalette(p)}
                >
                  <span className={`appearance-swatch appearance-swatch--${p}`} aria-hidden="true" />
                  {p === 'jade' ? 'Jade' : 'Clean'}
                </button>
              ))}
            </div>

            <label className="settings-label" style={{ marginTop: 14 }}>Color scheme</label>
            <div className="appearance-row">
              {(['system', 'light', 'dark'] as Scheme[]).map(s => (
                <button key={s}
                  className={`appearance-btn${scheme === s ? ' appearance-btn--active' : ''}`}
                  onClick={() => handleScheme(s)}
                  aria-pressed={scheme === s}
                >
                  {s === 'system' ? 'Auto' : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
          </section>

          {/* Identity */}
          <section className="settings-section">
            <h3 className="settings-section-title">Identity</h3>
            <label className="settings-label">Brain name</label>
            <input
              className="settings-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jade"
              maxLength={32}
            />
            <p className="settings-hint">How your assistant introduces itself in chat.</p>
          </section>

          {/* Model */}
          <section className="settings-section">
            <h3 className="settings-section-title">AI Model</h3>
            <p className="settings-hint" style={{ marginBottom: 12 }}>
              Changes take effect immediately — no restart needed.
            </p>
            <div className="model-cards">
              {models.map(m => {
                const sn          = shortName(m.name);
                const label       = MODEL_LABELS[sn] ?? MODEL_LABELS[m.name] ?? sn;
                const desc        = MODEL_DESCRIPTIONS[m.name] ?? MODEL_DESCRIPTIONS[sn] ?? 'Local model';
                const active      = m.name === selected || sn === shortName(selected);
                const recommended = sn === shortName(hwModel);
                return (
                  <button
                    key={m.name}
                    className={`model-card${active ? ' model-card--active' : ''}`}
                    onClick={() => setSelected(m.name)}
                  >
                    <div className="model-card-header">
                      <span className="model-card-name">{label}</span>
                      {recommended && (
                        <span className="model-card-hw">Recommended for your device</span>
                      )}
                      {!recommended && active && (
                        <span className="model-card-hw" style={{ background: 'var(--amber, #d29922)', color: '#fff' }}>⚠ Not recommended</span>
                      )}
                    </div>
                    <p className="model-card-desc">{desc}</p>
                    {!recommended && sn === 'qwen2.5:7b' && (
                      <p style={{ fontSize: 11, color: 'var(--amber, #d29922)', marginTop: 4 }}>
                        Requires 6 GB VRAM — may be very slow on your GPU
                      </p>
                    )}
                    {active && <span className="model-card-check">✓ Active</span>}
                  </button>
                );
              })}
            </div>
          </section>
          {/* Sources folder */}
          {window.electron?.changeSourcesDir && (
            <section className="settings-section">
              <h3 className="settings-section-title">Sources folder</h3>
              <p className="settings-hint" style={{ marginBottom: 10 }}>
                Where Jade saves your uploaded files (PDFs, videos, etc.).
              </p>
              {sourcesDir && (
                <p style={{
                  fontSize: 11, color: 'var(--text-2)',
                  background: 'var(--surface-1)', border: '1px solid var(--border)',
                  borderRadius: 6, padding: '6px 10px', marginBottom: 10,
                  wordBreak: 'break-all', fontFamily: 'monospace',
                }}>
                  {sourcesDir}
                </p>
              )}
              <button
                className="btn-g"
                style={{ width: '100%' }}
                onClick={handleChangeDir}
                disabled={changingDir}
              >
                {changingDir ? 'Choosing…' : 'Change folder'}
              </button>
              <p className="settings-hint" style={{ marginTop: 6 }}>
                New files go to the new folder — existing files stay in place.
              </p>
            </section>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-g" onClick={onClose}>Cancel</button>
          <button className="btn-p" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </aside>
    </>
  );
}
