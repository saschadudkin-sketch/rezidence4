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

registerSW();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
