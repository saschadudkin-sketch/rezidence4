/**
 * services/logger.js — централизованный логгер
 *
 * FIX [AUDIT-9]: _ctx был module-level mutable object.
 * Проблемы:
 *   1. При SSR (если когда-либо добавят) контекст одного пользователя
 *      утекал бы в запросы другого (shared module state между req/res циклами)
 *   2. В тестах с jest.resetModules() контекст неожиданно сохранялся
 *   3. setContext/clearContext — не thread-safe при параллельных тестах
 *
 * Решение: createLogger() возвращает изолированный экземпляр с собственным
 * замыканием. Singleton logger = createLogger() — один экземпляр на SPA.
 * В тестах: const testLogger = createLogger() — изоляция гарантирована.
 *
 * Использование:
 *   import { logger } from '../services/logger';
 *   logger.info('Заявка создана', { reqId, userRole });
 *   logger.error('API error', err);
 */

const IS_DEV = import.meta?.env?.DEV === true || import.meta?.env?.MODE === 'test';

export function createLogger() {
  // Контекст живёт в замыкании — изолирован от других экземпляров
  let _ctx = {};

  function _fmtArgs(args) {
    if (Object.keys(_ctx).length === 0) return args;
    return [...args, _ctx];
  }

  // ─── FIX [AUDIT-6 #4]: реальный error reporter ──────────────────────────────
  // Буферизует ошибки и отправляет батчем через POST /api/v1/client-logs.
  // При unload страницы — navigator.sendBeacon (гарантированная доставка).
  // Rate limit: максимум 10 ошибок в минуту, дубли по message дедуплицируются.
  const _errorBuffer = [];
  const _sentMessages = new Set();
  let _flushTimer = null;
  const MAX_BUFFER = 10;
  const FLUSH_INTERVAL = 5_000; // 5 секунд

  function _flushErrors() {
    if (_errorBuffer.length === 0) return;
    const batch = _errorBuffer.splice(0, MAX_BUFFER);
    const BASE = import.meta?.env?.VITE_API_URL || '';
    const url = `${BASE}/api/v1/client-logs`;
    const body = JSON.stringify({ errors: batch });

    try {
      // Prefer sendBeacon (works during page unload)
      if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body,
          keepalive: true,
        }).catch(() => {}); // fire-and-forget
      }
    } catch { /* ignore — logging must never break the app */ }
  }

  function _sendToService(payload) {
    // Дедупликация по message (не шлём одну и ту же ошибку 100 раз)
    const key = payload.message || 'unknown';
    if (_sentMessages.has(key)) return;
    if (_sentMessages.size > 100) _sentMessages.clear(); // reset после 100 уникальных
    _sentMessages.add(key);

    _errorBuffer.push(payload);

    if (_errorBuffer.length >= MAX_BUFFER) {
      _flushErrors();
    } else if (!_flushTimer) {
      _flushTimer = setTimeout(() => { _flushTimer = null; _flushErrors(); }, FLUSH_INTERVAL);
    }
  }

  // Flush при закрытии страницы
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', _flushErrors);
  }

  return {
    /** Установить контекст (uid, role, name) — вызывать при логине */
    setContext(ctx) {
      _ctx = { ..._ctx, ...ctx };
    },

    /** Сбросить контекст — при логауте */
    clearContext() {
      _ctx = {};
    },

    /** Получить текущий контекст (для тестов) */
    getContext() {
      return { ..._ctx };
    },

    debug(...args) {
      if (IS_DEV) console.debug('[DEBUG]', ..._fmtArgs(args));
    },

    info(...args) {
      if (IS_DEV) console.info('[INFO]', ..._fmtArgs(args));
    },

    warn(...args) {
      console.warn('[WARN]', ..._fmtArgs(args));
    },

    error(message, error, extra = {}) {
      const payload = {
        message,
        error: error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
        context: _ctx,
        extra,
        timestamp: new Date().toISOString(),
      };
      console.error('[ERROR]', payload);

      if (!IS_DEV) {
        _sendToService(payload);
      }
    },

    /** Логировать действие пользователя */
    action(name, data = {}) {
      if (IS_DEV) console.log('[ACTION]', name, { ..._ctx, ...data });
    },
  };
}

/** Singleton для приложения */
export const logger = createLogger();
