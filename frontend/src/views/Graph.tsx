import { useEffect, useState, useMemo, useRef } from 'react';
import { api } from '../api';

interface CollNode { id: string; name: string; color: string; source_count: number; }
interface Connection { source_name: string; target_name: string; reason: string; similarity: number; }
interface CollEdge { source: string; target: string; count: number; max_similarity: number; connections: Connection[]; }

// ── Force layout ──────────────────────────────────────────────────────────────
function forceLayout(
  ids: string[],
  radii: Record<string, number>,
  edges: Array<{ source: string; target: string; weight: number }>,
  W: number, H: number,
): Record<string, { x: number; y: number }> {
  if (!ids.length) return {};
  const px: Record<string, number> = {};
  const py: Record<string, number> = {};
  const vx: Record<string, number> = {};
  const vy: Record<string, number> = {};

  ids.forEach((id, i) => {
    const a = (2 * Math.PI * i) / ids.length - Math.PI / 2;
    px[id] = W / 2 + Math.min(W, H) * 0.32 * Math.cos(a);
    py[id] = H / 2 + Math.min(W, H) * 0.32 * Math.sin(a);
    vx[id] = vy[id] = 0;
  });

  const LABEL_PAD = 32;
  const K = Math.sqrt((W * H) / Math.max(ids.length, 1)) * 1.8;

  for (let t = 0; t < 700; t++) {
    const α = Math.max(0.008, 1 - t / 580);

    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        const dx = (px[b] - px[a]) || 0.01;
        const dy = (py[b] - py[a]) || 0.01;
        const d  = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const minD = (radii[a] ?? 10) + (radii[b] ?? 10) + LABEL_PAD + 30;
        const f = d < minD
          ? (minD - d) * 6 * α
          : K * K / d * α * 0.4;
        vx[a] -= dx / d * f * 0.5; vy[a] -= dy / d * f * 0.5;
        vx[b] += dx / d * f * 0.5; vy[b] += dy / d * f * 0.5;
      }
    }

    for (const e of edges) {
      if (!(e.source in px) || !(e.target in px)) continue;
      const dx = px[e.target] - px[e.source];
      const dy = py[e.target] - py[e.source];
      const d  = Math.sqrt(dx * dx + dy * dy) || 0.1;
      const ideal = K * 0.55;
      if (d > ideal) {
        const f = Math.min((d - ideal) / K * e.weight * α * 0.25, 6);
        vx[e.source] += dx / d * f; vy[e.source] += dy / d * f;
        vx[e.target] -= dx / d * f; vy[e.target] -= dy / d * f;
      }
    }

    for (const id of ids) {
      vx[id] += (W / 2 - px[id]) * 0.004;
      vy[id] += (H / 2 - py[id]) * 0.004;
    }

    for (const id of ids) {
      vx[id] *= 0.72; vy[id] *= 0.72;
      const r = (radii[id] ?? 10) + LABEL_PAD;
      px[id] = Math.max(r, Math.min(W - r, px[id] + vx[id]));
      py[id] = Math.max(radii[id] ?? 10, Math.min(H - (radii[id] ?? 10) - LABEL_PAD, py[id] + vy[id]));
    }
  }

  return Object.fromEntries(ids.map(id => [id, { x: px[id], y: py[id] }]));
}

// ── Component ─────────────────────────────────────────────────────────────────
interface Props {
  onOpenCollection: (collectionId: string) => void;
  onClose: () => void;
}

export function KnowledgeGraph({ onOpenCollection, onClose }: Props) {
  const W = 1000, H = 620;

  const [graph,   setGraph]   = useState<{ nodes: CollNode[]; edges: CollEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  // null = none focused; string = focused node id
  const [focusId, setFocusId] = useState<string | null>(null);
  // selected edge for side panel
  const [panel,   setPanel]   = useState<CollEdge | null>(null);

  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  const panRef = useRef<{ sx: number; sy: number; vx0: number; vy0: number; vw0: number; vh0: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    api.graph.collections()
      .then(setGraph)
      .catch(e => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  // ── Radii ──────────────────────────────────────────────────────────────────
  const radii = useMemo(() => {
    if (!graph) return {} as Record<string, number>;
    const r: Record<string, number> = {};
    graph.nodes.forEach(n => { r[n.id] = Math.max(14, Math.min(30, 9 + Math.sqrt(n.source_count) * 5)); });
    return r;
  }, [graph]);

  // ── Layout ─────────────────────────────────────────────────────────────────
  const positions = useMemo(() => {
    if (!graph) return {};
    return forceLayout(
      graph.nodes.map(n => n.id), radii,
      graph.edges.map(e => ({ source: e.source, target: e.target, weight: Math.log1p(e.count) + 0.3 })),
      W, H,
    );
  }, [graph, radii]);

  // Set of node ids connected to the focused node
  const connectedIds = useMemo(() => {
    if (!focusId || !graph) return null;
    const set = new Set<string>([focusId]);
    graph.edges.forEach(e => {
      if (e.source === focusId) set.add(e.target);
      if (e.target === focusId) set.add(e.source);
    });
    return set;
  }, [focusId, graph]);

  // ── Zoom / pan ────────────────────────────────────────────────────────────
  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = ((e.clientX - rect.left) / rect.width)  * vb.w + vb.x;
    const my = ((e.clientY - rect.top)  / rect.height) * vb.h + vb.y;
    const f  = e.deltaY > 0 ? 1.12 : 0.89;
    setVb(v => {
      const nw = Math.max(W * 0.2, Math.min(W * 4, v.w * f));
      const nh = Math.max(H * 0.2, Math.min(H * 4, v.h * f));
      return { x: mx - (mx - v.x) * nw / v.w, y: my - (my - v.y) * nh / v.h, w: nw, h: nh };
    });
  }
  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if ((e.target as Element).closest('[data-node]') || (e.target as Element).closest('[data-edge]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { sx: e.clientX, sy: e.clientY, vx0: vb.x, vy0: vb.y, vw0: vb.w, vh0: vb.h };
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!panRef.current) return;
    const rect = svgRef.current!.getBoundingClientRect();
    const dx = (e.clientX - panRef.current.sx) / rect.width  * panRef.current.vw0;
    const dy = (e.clientY - panRef.current.sy) / rect.height * panRef.current.vh0;
    setVb(v => ({ ...v, x: panRef.current!.vx0 - dx, y: panRef.current!.vy0 - dy }));
  }
  function onPointerUp() { panRef.current = null; }

  function handleNodeClick(node: CollNode) {
    if (focusId === node.id) {
      setFocusId(null);
    } else {
      setFocusId(node.id);
      setPanel(null);
    }
  }

  function handleEdgeClick(edge: CollEdge) {
    setPanel(panel?.source === edge.source && panel?.target === edge.target ? null : edge);
    setFocusId(null);
  }

  function handleBgClick() {
    setFocusId(null);
    setPanel(null);
  }

  // ── Search ────────────────────────────────────────────────────────────────
  const q = search.toLowerCase();
  function nodeVisible(name: string) { return !q || name.toLowerCase().includes(q); }
  function nodeOp(id: string, name: string) {
    if (connectedIds && !connectedIds.has(id)) return 0.08;
    if (!nodeVisible(name)) return 0.08;
    return 1;
  }
  function edgeOp(e: CollEdge) {
    if (connectedIds && !(connectedIds.has(e.source) && connectedIds.has(e.target))) return 0.06;
    return 1;
  }

  const isEmpty = !loading && graph?.nodes.length === 0;
  function trunc(s: string, max: number) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

  const focusedNode = focusId ? graph?.nodes.find(n => n.id === focusId) : null;
  const panelNodeA  = panel ? graph?.nodes.find(n => n.id === panel.source) : null;
  const panelNodeB  = panel ? graph?.nodes.find(n => n.id === panel.target) : null;

  return (
    <div className="kg-overlay">
      {/* Header — search + focused node breadcrumb only */}
      <div className="kg-header">
        <div className="kg-breadcrumb">
          {focusedNode ? (
            <>
              <span className="kg-breadcrumb-cur" style={{ color: focusedNode.color }}>
                {focusedNode.name}
              </span>
              <button className="kg-clear-focus" onClick={() => { setFocusId(null); setPanel(null); }}>
                ×
              </button>
            </>
          ) : (
            <span className="kg-title-text" style={{ color: 'var(--text-3)', fontWeight: 400 }}>
              All collections
            </span>
          )}
        </div>
        <div className="kg-header-right">
          <div className="kg-search-wrap">
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="5.5" cy="5.5" r="4"/><path d="m9 9 3.5 3.5" strokeLinecap="round"/>
            </svg>
            <input className="kg-search" placeholder="Filter collections…" value={search}
              onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="kg-body">
        {/* Canvas */}
        <div className="kg-canvas" onClick={handleBgClick}>
          {loading && (
            <div className="kg-state">
              <div className="kg-spinner"/>Building graph…
            </div>
          )}
          {error && (
            <div className="kg-state" style={{ color: 'var(--error, #e05)' }}>
              Failed to load graph — is the backend running?
              <span style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 4 }}>{error}</span>
            </div>
          )}
          {isEmpty && <div className="kg-state">No collections yet.</div>}

          {!loading && !isEmpty && graph && (
            <svg
              ref={svgRef}
              viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
              style={{ width: '100%', height: '100%', cursor: panRef.current ? 'grabbing' : 'default' }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            >
              {/* Edges */}
              {graph.edges.map((e, i) => {
                const a = positions[e.source], b = positions[e.target];
                if (!a || !b) return null;
                const isSelected = panel?.source === e.source && panel?.target === e.target;
                const op = edgeOp(e);
                const hov = hovered === `edge-${i}`;
                return (
                  <line key={i}
                    data-edge="1"
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={isSelected ? 'var(--accent)' : hov ? 'var(--accent)' : 'var(--border-mid)'}
                    strokeWidth={isSelected ? 2.5 : hov ? 1.8 : 1.2}
                    strokeOpacity={op * (isSelected ? 1 : hov ? 0.9 : 0.55)}
                    style={{ cursor: 'pointer', transition: 'stroke .12s, stroke-width .12s, stroke-opacity .18s' }}
                    onMouseEnter={() => setHovered(`edge-${i}`)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={ev => { ev.stopPropagation(); handleEdgeClick(e); }}
                  />
                );
              })}

              {/* Nodes */}
              {graph.nodes.map((node, idx) => {
                const pos = positions[node.id];
                if (!pos) return null;
                const r   = radii[node.id] ?? 16;
                const op  = nodeOp(node.id, node.name);
                const hov = hovered === node.id;
                return (
                  <g key={node.id} data-node="1"
                    style={{ cursor: 'pointer', opacity: op, transition: 'opacity .18s' }}
                    onMouseEnter={() => setHovered(node.id)}
                    onMouseLeave={() => setHovered(null)}
                    onClick={ev => { ev.stopPropagation(); handleNodeClick(node); }}
                  >
                    {/* Opaque mask behind node so edge lines don't bleed through */}
                    <circle cx={pos.x} cy={pos.y} r={r + 1}
                      fill="var(--bg)"
                      style={{ pointerEvents: 'none' }}
                    />
                    <circle cx={pos.x} cy={pos.y} r={r}
                      fill={node.color}
                      stroke={hov ? 'var(--text-1)' : 'none'}
                      strokeWidth={hov ? 2 : 0}
                      strokeOpacity={0.4}
                      className={hov ? undefined : 'kg-breathe'}
                      style={{
                        transformBox: 'fill-box',
                        transformOrigin: 'center',
                        animationDelay: `${idx * 0.5}s`,
                      }}
                    />
                    <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="central"
                      fill="rgba(255,255,255,0.95)" fontSize={r > 22 ? 11 : 9} fontWeight={700}
                      pointerEvents="none"
                    >
                      {node.source_count}
                    </text>
                    <text x={pos.x} y={pos.y + r + 14} textAnchor="middle"
                      fill={hov ? 'var(--text-1)' : 'var(--text-2)'}
                      fontSize={10.5} fontWeight={hov ? 600 : 400}
                      className="kg-label"
                      pointerEvents="none"
                      style={{ transition: 'fill .12s' }}
                    >
                      {trunc(node.name, 18)}
                    </text>
                  </g>
                );
              })}
            </svg>
          )}

          {!loading && !isEmpty && graph && graph.edges.length === 0 && (
            <div className="kg-hint">No connections yet — restart Jade to recompute</div>
          )}
          {!loading && !isEmpty && !error && graph && (
            <div className="kg-legend">
              <span>Scroll to zoom · Drag to pan · Click node to focus · Click edge to see why</span>
            </div>
          )}
        </div>

        {/* Side panel */}
        {panel && panelNodeA && panelNodeB && (
          <div className="kg-panel" onClick={e => e.stopPropagation()}>
            <div className="kg-panel-header">
              <div className="kg-panel-title">Connection</div>
              <button className="kg-panel-close" onClick={() => setPanel(null)}>
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                  <path d="M1 1l10 10M11 1L1 11"/>
                </svg>
              </button>
            </div>
            <div className="kg-panel-collections">
              <button className="kg-panel-coll" style={{ '--coll-color': panelNodeA.color } as React.CSSProperties}
                onClick={() => { onOpenCollection(panelNodeA.id); onClose(); }}>
                <span className="kg-panel-coll-dot" />
                {panelNodeA.name}
              </button>
              <span className="kg-panel-arrow" aria-hidden="true">
                <svg width="14" height="8" viewBox="0 0 14 8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 4h12M3.5 1.5L1 4l2.5 2.5M10.5 1.5L13 4l-2.5 2.5"/>
                </svg>
              </span>
              <button className="kg-panel-coll" style={{ '--coll-color': panelNodeB.color } as React.CSSProperties}
                onClick={() => { onOpenCollection(panelNodeB.id); onClose(); }}>
                <span className="kg-panel-coll-dot" />
                {panelNodeB.name}
              </button>
            </div>
            <div className="kg-panel-count">{panel.connections.length} shared source{panel.connections.length !== 1 ? 's' : ''}</div>
            <div className="kg-panel-list">
              {panel.connections.map((c, i) => (
                <div key={i} className="kg-panel-item">
                  <div className="kg-panel-sources">
                    <span className="kg-panel-src">{c.source_name}</span>
                    <span className="kg-panel-src-sep">–</span>
                    <span className="kg-panel-src">{c.target_name}</span>
                    <span className="kg-panel-sim">{Math.round(c.similarity * 100)}%</span>
                  </div>
                  {c.reason && (
                    <div className="kg-panel-reason">{c.reason}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
