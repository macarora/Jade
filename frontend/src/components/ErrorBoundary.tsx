import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props  { children: ReactNode }
interface State  { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Jade] Render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', height: '100vh', gap: 16,
          background: 'var(--bg, #0d1117)', color: 'var(--text-1, #e6edf3)',
          fontFamily: 'var(--font-ui, "Segoe UI", system-ui, sans-serif)',
          padding: 32,
        }}>
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p style={{ fontSize: 15, fontWeight: 500 }}>Something went wrong</p>
          <p style={{ fontSize: 12, color: 'var(--text-3, #8b949e)', maxWidth: 380, textAlign: 'center' }}>
            Close and reopen Jade to restart. If this keeps happening, check launcher.log for details.
          </p>
          <pre style={{
            fontSize: 11, color: 'var(--text-3, #8b949e)', background: 'var(--surface-1, #161b22)',
            border: '1px solid var(--border, #30363d)', borderRadius: 6,
            padding: '8px 12px', maxWidth: 420, overflowX: 'auto',
          }}>{this.state.error.message}</pre>
          <button
            style={{
              padding: '6px 16px', borderRadius: 6, border: '1px solid var(--border, #30363d)',
              background: 'var(--surface-1, #161b22)', color: 'var(--text-1, #e6edf3)',
              fontSize: 12, cursor: 'pointer',
            }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
