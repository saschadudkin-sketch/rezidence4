/**
 * loginMetrics.js — A-07: login telemetry helpers extracted from Login.jsx.
 * Dispatches CustomEvents so any analytics listener can pick them up
 * without coupling the login form to a specific analytics SDK.
 */

export function emitLoginMetric(type, payload = {}) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('rz:login-metric', {
    detail: { type, ...payload, ts: Date.now() },
  }));
}
