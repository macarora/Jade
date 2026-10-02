import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Apply saved appearance prefs before first render to avoid flash
const savedPalette = localStorage.getItem('jade-palette');
if (savedPalette) document.documentElement.setAttribute('data-palette', savedPalette);
const savedScheme = localStorage.getItem('jade-scheme');
if (savedScheme && savedScheme !== 'system') document.documentElement.setAttribute('data-theme', savedScheme);

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
