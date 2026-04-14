/**
 * loginMetrics.ts - CQ-02: migrated from loginMetrics.js
 * A-07: emitLoginMetric extracted from Login.jsx.
 */
export type LoginMetricType =
  | 'send_code_rejected'
  | 'send_code_success'
  | 'send_code_failed'
  | 'resend_rejected'
  | 'resend_success'
  | 'resend_failed'
  | 'verify_rejected'
  | 'verify_success'
  | 'verify_failed';

export type LoginMetricPayload = Record<string, unknown>;

export type LoginMetricDetail = LoginMetricPayload & {
  type: LoginMetricType;
  ts: number;
};

export function emitLoginMetric(type: LoginMetricType, payload: LoginMetricPayload = {}): void {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  const detail: LoginMetricDetail = { type, ...payload, ts: Date.now() };
  window.dispatchEvent(new CustomEvent<LoginMetricDetail>('rz:login-metric', { detail }));
}
