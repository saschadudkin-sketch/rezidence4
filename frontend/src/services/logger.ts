/**
 * Centralized client logger.
 */
const MODE = import.meta?.env?.MODE ?? process.env.NODE_ENV;
const IS_DEV = import.meta?.env?.DEV === true || MODE === 'test' || MODE === 'development';
const PROCESS_ENV = typeof process !== 'undefined' ? process.env : {};
const IS_TEST = MODE === 'test' || PROCESS_ENV.NODE_ENV === 'test' || Boolean(PROCESS_ENV.VITEST);

function isConsoleEnabled(): boolean {
  return IS_DEV && (!IS_TEST || PROCESS_ENV.VITEST_LOGGER_CONSOLE === '1');
}

export type LoggerContext = Record<string, unknown>;
export type LoggerArg = unknown;
export type ErrorPayload = {
  message: string;
  error: unknown;
  context: LoggerContext;
  extra: Record<string, unknown>;
  timestamp: string;
};

export function createLogger() {
  let context: LoggerContext = {};
  const errorBuffer: ErrorPayload[] = [];
  const sentMessages = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const MAX_BUFFER = 10;
  const FLUSH_INTERVAL = 5_000;

  function formatArgs(args: LoggerArg[]): LoggerArg[] {
    if (Object.keys(context).length === 0) return args;
    return [...args, context];
  }

  function flushErrors(): void {
    if (errorBuffer.length === 0) return;

    const batch = errorBuffer.splice(0, MAX_BUFFER);
    const baseUrl = import.meta?.env?.VITE_API_URL || '';
    const url = `${baseUrl}/api/v1/client-logs`;
    const body = JSON.stringify({ errors: batch });

    try {
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        return;
      }

      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // Logging failures must never break the app.
    }
  }

  function sendToService(payload: ErrorPayload): void {
    const key = payload.message || 'unknown';
    if (sentMessages.has(key)) return;
    if (sentMessages.size > 100) sentMessages.clear();
    sentMessages.add(key);

    errorBuffer.push(payload);

    if (errorBuffer.length >= MAX_BUFFER) {
      flushErrors();
      return;
    }

    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushErrors();
      }, FLUSH_INTERVAL);
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushErrors);
  }

  return {
    setContext(nextContext: LoggerContext): void {
      context = { ...context, ...nextContext };
    },

    clearContext(): void {
      context = {};
    },

    getContext(): LoggerContext {
      return { ...context };
    },

    debug(...args: LoggerArg[]): void {
      if (isConsoleEnabled()) console.info('[DEBUG]', ...formatArgs(args));
    },

    info(...args: LoggerArg[]): void {
      if (isConsoleEnabled()) console.info('[INFO]', ...formatArgs(args));
    },

    warn(...args: LoggerArg[]): void {
      if (isConsoleEnabled()) console.warn('[WARN]', ...formatArgs(args));
    },

    error(message: string, error: unknown, extra: Record<string, unknown> = {}): void {
      const payload: ErrorPayload = {
        message,
        error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        context,
        extra,
        timestamp: new Date().toISOString(),
      };

      if (isConsoleEnabled()) {
        console.error('[ERROR]', payload);
        return;
      }

      if (IS_DEV) return;

      sendToService(payload);
    },

    action(name: string, data: Record<string, unknown> = {}): void {
      if (isConsoleEnabled()) console.info('[ACTION]', name, { ...context, ...data });
    },
  };
}

export type Logger = ReturnType<typeof createLogger>;
export const logger = createLogger();
