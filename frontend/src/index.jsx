import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { registerSW } from './utils/swUtils';

// Suppress harmless ResizeObserver loop error (browser-level, not a bug)
const ro = window.onerror;
window.onerror = (msg, ...args) => {
  if (typeof msg === 'string' && msg.includes('ResizeObserver')) return true;
  return ro ? ro(msg, ...args) : false;
};

// Логируем необработанные Promise-ошибки (SSE, lazy-chunk, API failures)
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason);
  // Игнорируем намеренные отмены AbortController
  if (msg === 'AbortError' || event.reason?.name === 'AbortError') return;
  if (msg.includes('ResizeObserver')) return;
  console.error('[App] Unhandled rejection:', event.reason);
});

registerSW();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
