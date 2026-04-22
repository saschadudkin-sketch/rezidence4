import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

/**
 * Admin SPA entry point.  Loaded only from admin.html at admin.domhub.su
 * (or a /admin.html path during local dev).  Keeping this file tiny so
 * the main work (auth, routing, pages) lives next to its tests.
 */

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('#root not found in admin.html');
}

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
