/**
 * loginMetrics.ts — CQ-02: migrated from loginMetrics.js
 * A-07: emitLoginMetric extracted from Login.jsx.
 */
export function emitLoginMetric(type: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent('rz:login-metric', {
    detail: { type, ...payload, ts: Date.now() },
  }));
}
