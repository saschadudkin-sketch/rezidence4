// @ts-check
/**
 * utils/events.js — A-01: Centralized custom event registry.
 *
 * WHY: Custom window events (rz:*) were scattered across multiple files as
 * magic strings. Renaming one event required grep-based search across the codebase,
 * and missing a listener caused silent failures with no type checking.
 *
 * HOW: All event names are defined as constants here. Typed emit/on helpers
 * wrap dispatchEvent/addEventListener with automatic cleanup return values.
 *
 * USAGE:
 *   import { AppEvents, onSseStatus, emitSseStatus } from '../utils/events';
 *   const cleanup = onSseStatus(({ connected }) => setSseOnline(connected));
 *   // In cleanup: cleanup();
 */

// ─── Event name constants ─────────────────────────────────────────────────────

export const AppEvents = /** @type {const} */ ({
  /** JWT expired / 401 received — triggers logout */
  UNAUTHORIZED: 'rz:unauthorized',
  /** JWT expired and refresh failed — detail: { reason: string, returnTo?: string } */
  SESSION_EXPIRED: 'rz:session-expired',

  /** SSE connection state changed — detail: { connected: boolean } */
  SSE_STATUS: 'rz:sse-status',

  /** Watchdog detected stale SSE (no events >60s) — triggers retryKey++ */
  SSE_FORCE_RECONNECT: 'rz:sse-force-reconnect',

  /** SSE received any event — resets watchdog timer */
  SSE_ACTIVITY: 'rz:sse-activity',

  /** SSE exhausted max retry attempts — requires manual user action */
  SSE_PERMANENT_ERROR: 'rz:sse-permanent-error',
  /** Realtime transport state transition — detail: { from: string, to: string, at: number, durationMs: number } */
  REALTIME_STATE: 'rz:realtime-state',
});

// ─── Typed emit helpers ───────────────────────────────────────────────────────

/**
 * @param {{ connected: boolean }} detail
 */
export function emitSseStatus(detail) {
  window.dispatchEvent(new CustomEvent(AppEvents.SSE_STATUS, { detail }));
}

export function emitSseForceReconnect() {
  window.dispatchEvent(new CustomEvent(AppEvents.SSE_FORCE_RECONNECT));
}

export function emitSseActivity() {
  window.dispatchEvent(new CustomEvent(AppEvents.SSE_ACTIVITY));
}

export function emitSsePermanentError() {
  window.dispatchEvent(new CustomEvent(AppEvents.SSE_PERMANENT_ERROR));
}

export function emitUnauthorized() {
  window.dispatchEvent(new CustomEvent(AppEvents.UNAUTHORIZED));
}

/**
 * @param {{ reason: string, returnTo?: string }} detail
 */
export function emitSessionExpired(detail) {
  window.dispatchEvent(new CustomEvent(AppEvents.SESSION_EXPIRED, { detail }));
}

/**
 * @param {{ from: string, to: string, at: number, durationMs: number }} detail
 */
export function emitRealtimeState(detail) {
  window.dispatchEvent(new CustomEvent(AppEvents.REALTIME_STATE, { detail }));
}

// ─── Typed on helpers — return cleanup function ───────────────────────────────

/**
 * @param {(detail: { connected: boolean }) => void} handler
 * @returns {() => void} cleanup
 */
export function onSseStatus(handler) {
  const listener = (e) => handler(/** @type {CustomEvent} */ (e).detail);
  window.addEventListener(AppEvents.SSE_STATUS, listener);
  return () => window.removeEventListener(AppEvents.SSE_STATUS, listener);
}

/**
 * @param {() => void} handler
 * @returns {() => void} cleanup
 */
export function onSseForceReconnect(handler) {
  window.addEventListener(AppEvents.SSE_FORCE_RECONNECT, handler);
  return () => window.removeEventListener(AppEvents.SSE_FORCE_RECONNECT, handler);
}

/**
 * @param {() => void} handler
 * @returns {() => void} cleanup
 */
export function onSseActivity(handler) {
  window.addEventListener(AppEvents.SSE_ACTIVITY, handler);
  return () => window.removeEventListener(AppEvents.SSE_ACTIVITY, handler);
}

/**
 * @param {() => void} handler
 * @returns {() => void} cleanup
 */
export function onSsePermanentError(handler) {
  window.addEventListener(AppEvents.SSE_PERMANENT_ERROR, handler);
  return () => window.removeEventListener(AppEvents.SSE_PERMANENT_ERROR, handler);
}

/**
 * @param {() => void} handler
 * @returns {() => void} cleanup
 */
export function onUnauthorized(handler) {
  window.addEventListener(AppEvents.UNAUTHORIZED, handler);
  return () => window.removeEventListener(AppEvents.UNAUTHORIZED, handler);
}

/**
 * @param {(detail: { reason: string, returnTo?: string }) => void} handler
 * @returns {() => void} cleanup
 */
export function onSessionExpired(handler) {
  const listener = (e) => handler(/** @type {CustomEvent} */ (e).detail);
  window.addEventListener(AppEvents.SESSION_EXPIRED, listener);
  return () => window.removeEventListener(AppEvents.SESSION_EXPIRED, listener);
}

/**
 * @param {(detail: { from: string, to: string, at: number, durationMs: number }) => void} handler
 * @returns {() => void} cleanup
 */
export function onRealtimeState(handler) {
  const listener = (e) => handler(/** @type {CustomEvent} */ (e).detail);
  window.addEventListener(AppEvents.REALTIME_STATE, listener);
  return () => window.removeEventListener(AppEvents.REALTIME_STATE, listener);
}
