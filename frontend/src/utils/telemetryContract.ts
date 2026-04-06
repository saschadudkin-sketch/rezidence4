import { logger } from '../services/logger';

export const UX_METRICS = {
  VIEW_READY: 'ux.view_ready',
  ACTION_SUCCESS: 'ux.action_success',
  ACTION_FAILURE: 'ux.action_failure',
  NAV_FORBIDDEN_REDIRECT: 'ux.nav_forbidden_redirect',
  SSE_RECONNECT_MS: 'sse.reconnect.ms',
  CONNECTION_TIMEOUT: 'sse.connection.timeout',
} as const;

const TELEMETRY_STORAGE_KEY = 'rz.telemetry.events.v1';
const TELEMETRY_MAX_EVENTS = 500;
const SLA_WINDOW_MS = 24 * 60 * 60 * 1000;

type MetricName = (typeof UX_METRICS)[keyof typeof UX_METRICS];
type MetricPayload = Record<string, unknown>;

type TelemetryEvent = {
  name: MetricName;
  payload: MetricPayload;
  at: number;
};

const metricValidators: Record<MetricName, (payload: MetricPayload) => boolean> = {
  [UX_METRICS.VIEW_READY]: (p) => typeof p.role === 'string',
  [UX_METRICS.ACTION_SUCCESS]: (p) => typeof p.action === 'string',
  [UX_METRICS.ACTION_FAILURE]: (p) => typeof p.action === 'string',
  [UX_METRICS.NAV_FORBIDDEN_REDIRECT]: (p) =>
    typeof p.role === 'string' && typeof p.from === 'string' && typeof p.to === 'string',
  [UX_METRICS.SSE_RECONNECT_MS]: (p) => typeof p.durationMs === 'number',
  [UX_METRICS.CONNECTION_TIMEOUT]: () => true,
};

const listeners = new Set<(event: TelemetryEvent) => void>();

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readEvents(): TelemetryEvent[] {
  if (!canUseStorage()) return [];
  try {
    const raw = window.localStorage.getItem(TELEMETRY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && typeof e.name === 'string' && typeof e.at === 'number');
  } catch {
    return [];
  }
}

function writeEvents(events: TelemetryEvent[]) {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(events.slice(-TELEMETRY_MAX_EVENTS)));
  } catch {
    // ignore storage quota errors for telemetry
  }
}

export function emitUxMetric(name: MetricName, payload: MetricPayload = {}) {
  const validator = metricValidators[name];
  if (validator && !validator(payload)) {
    logger.warn('[ux-metric] payload validation failed', { name, payload });
    return;
  }

  const event: TelemetryEvent = { name, payload, at: Date.now() };
  const events = readEvents();
  events.push(event);
  writeEvents(events);

  logger.info('[ux-metric]', event);
  listeners.forEach((fn) => fn(event));
}

export function subscribeUxMetrics(listener: (event: TelemetryEvent) => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] || 0;
}

export function getSlaSnapshot(windowMs = SLA_WINDOW_MS) {
  const fromTs = Date.now() - windowMs;
  const events = readEvents().filter((e) => e.at >= fromTs);

  const reconnectDurations = events
    .filter((e) => e.name === UX_METRICS.SSE_RECONNECT_MS)
    .map((e) => Number(e.payload.durationMs || 0))
    .filter((n) => Number.isFinite(n) && n > 0);

  const timeoutCount = events.filter((e) => e.name === UX_METRICS.CONNECTION_TIMEOUT).length;
  const viewReadyCount = events.filter((e) => e.name === UX_METRICS.VIEW_READY).length;
  const actionSuccess = events.filter((e) => e.name === UX_METRICS.ACTION_SUCCESS).length;
  const actionFailure = events.filter((e) => e.name === UX_METRICS.ACTION_FAILURE).length;
  const actionTotal = actionSuccess + actionFailure;

  const reconnectAvgMs = reconnectDurations.length
    ? Math.round(reconnectDurations.reduce((a, b) => a + b, 0) / reconnectDurations.length)
    : 0;

  return {
    windowMs,
    eventsTotal: events.length,
    timeoutCount,
    viewReadyCount,
    reconnect: {
      samples: reconnectDurations.length,
      avgMs: reconnectAvgMs,
      p95Ms: Math.round(percentile(reconnectDurations, 95)),
      slaMet: reconnectDurations.length === 0 ? true : reconnectAvgMs <= 15000,
    },
    action: {
      success: actionSuccess,
      failure: actionFailure,
      successRate: actionTotal ? Number(((actionSuccess / actionTotal) * 100).toFixed(1)) : 100,
      slaMet: actionTotal === 0 ? true : (actionSuccess / actionTotal) >= 0.99,
    },
    availability: {
      timeoutRate: viewReadyCount ? Number(((timeoutCount / viewReadyCount) * 100).toFixed(2)) : 0,
      slaMet: viewReadyCount === 0 ? true : (timeoutCount / viewReadyCount) <= 0.01,
    },
  };
}
