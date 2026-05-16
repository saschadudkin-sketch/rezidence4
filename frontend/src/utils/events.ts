/**
 * utils/events.ts - A-01: Centralized custom event registry.
 */
export const AppEvents = {
  UNAUTHORIZED: 'rz:unauthorized',
  SESSION_EXPIRED: 'rz:session-expired',
  SSE_STATUS: 'rz:sse-status',
  SSE_FORCE_RECONNECT: 'rz:sse-force-reconnect',
  SSE_ACTIVITY: 'rz:sse-activity',
  SSE_RECOVERED_AFTER_GAP: 'rz:sse-recovered-after-gap',
  SSE_PERMANENT_ERROR: 'rz:sse-permanent-error',
  REALTIME_STATE: 'rz:realtime-state',
} as const;

export type AppEventName = typeof AppEvents[keyof typeof AppEvents];
export type SseStatusDetail = { connected: boolean };
export type SessionExpiredDetail = { reason: string; returnTo?: string };
export type RealtimeStateDetail = { from: string; to: string; at: number; durationMs: number };

function emitWindowEvent<TDetail>(name: AppEventName, detail?: TDetail): void {
  window.dispatchEvent(new CustomEvent<TDetail>(name, detail === undefined ? undefined : { detail }));
}

function onWindowEvent<TDetail>(name: AppEventName, handler: (detail: TDetail) => void): () => void {
  const listener: EventListener = (event) => handler((event as CustomEvent<TDetail>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

export function emitSseStatus(detail: SseStatusDetail): void {
  emitWindowEvent(AppEvents.SSE_STATUS, detail);
}

export function emitSseForceReconnect(): void {
  emitWindowEvent(AppEvents.SSE_FORCE_RECONNECT);
}

export function emitSseActivity(): void {
  emitWindowEvent(AppEvents.SSE_ACTIVITY);
}

export function emitSseRecoveredAfterGap(): void {
  emitWindowEvent(AppEvents.SSE_RECOVERED_AFTER_GAP);
}

export function emitSsePermanentError(): void {
  emitWindowEvent(AppEvents.SSE_PERMANENT_ERROR);
}

export function emitUnauthorized(): void {
  emitWindowEvent(AppEvents.UNAUTHORIZED);
}

export function emitSessionExpired(detail: SessionExpiredDetail): void {
  emitWindowEvent(AppEvents.SESSION_EXPIRED, detail);
}

export function emitRealtimeState(detail: RealtimeStateDetail): void {
  emitWindowEvent(AppEvents.REALTIME_STATE, detail);
}

export function onSseStatus(handler: (detail: SseStatusDetail) => void): () => void {
  return onWindowEvent(AppEvents.SSE_STATUS, handler);
}

export function onSseForceReconnect(handler: () => void): () => void {
  const listener: EventListener = () => handler();
  window.addEventListener(AppEvents.SSE_FORCE_RECONNECT, listener);
  return () => window.removeEventListener(AppEvents.SSE_FORCE_RECONNECT, listener);
}

export function onSseActivity(handler: () => void): () => void {
  const listener: EventListener = () => handler();
  window.addEventListener(AppEvents.SSE_ACTIVITY, listener);
  return () => window.removeEventListener(AppEvents.SSE_ACTIVITY, listener);
}

export function onSseRecoveredAfterGap(handler: () => void): () => void {
  const listener: EventListener = () => handler();
  window.addEventListener(AppEvents.SSE_RECOVERED_AFTER_GAP, listener);
  return () => window.removeEventListener(AppEvents.SSE_RECOVERED_AFTER_GAP, listener);
}

export function onSsePermanentError(handler: () => void): () => void {
  const listener: EventListener = () => handler();
  window.addEventListener(AppEvents.SSE_PERMANENT_ERROR, listener);
  return () => window.removeEventListener(AppEvents.SSE_PERMANENT_ERROR, listener);
}

export function onUnauthorized(handler: () => void): () => void {
  const listener: EventListener = () => handler();
  window.addEventListener(AppEvents.UNAUTHORIZED, listener);
  return () => window.removeEventListener(AppEvents.UNAUTHORIZED, listener);
}

export function onSessionExpired(handler: (detail: SessionExpiredDetail) => void): () => void {
  return onWindowEvent(AppEvents.SESSION_EXPIRED, handler);
}

export function onRealtimeState(handler: (detail: RealtimeStateDetail) => void): () => void {
  return onWindowEvent(AppEvents.REALTIME_STATE, handler);
}
