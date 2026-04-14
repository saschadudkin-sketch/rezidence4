import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App';
import { registerSW, shouldRegisterSW } from './utils/swUtils';
import { reportWebVitals } from './utils/webVitals';

// ─── Sentry error tracking ─────────────────────────────────────────────────────
// Activated only when VITE_SENTRY_DSN is set — no-op in dev/demo without it.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_APP_VERSION,
    tracesSampleRate: 0.1, // 10% of transactions for performance monitoring
    replaysOnErrorSampleRate: 1.0,
  });
}

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
  if (import.meta.env.DEV) {
    console.error('[App] Unhandled rejection:', event.reason);
  } else if (import.meta.env.VITE_SENTRY_DSN) {
    Sentry.captureException(event.reason);
  }
});

if (shouldRegisterSW()) registerSW();
reportWebVitals();

const rootContainer = document.getElementById('root');
if (!rootContainer) {
  throw new Error('Root container "#root" was not found');
}

const root = ReactDOM.createRoot(rootContainer);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
