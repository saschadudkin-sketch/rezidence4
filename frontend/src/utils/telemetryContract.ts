import { logger } from '../services/logger';

export const UX_METRICS = {
  VIEW_READY: 'ux.view_ready',
  ACTION_SUCCESS: 'ux.action_success',
  SSE_RECONNECT_MS: 'sse.reconnect.ms',
  CONNECTION_TIMEOUT: 'sse.connection.timeout',
} as const;

export function emitUxMetric(name: string, payload: Record<string, unknown> = {}) {
  logger.info('[ux-metric]', { name, ...payload, at: Date.now() });
}
