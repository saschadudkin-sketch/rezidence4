export const LIVE_MODE = 'live';
export const DEMO_MODE = 'demo';
const ALLOWED_MODES = new Set([LIVE_MODE, DEMO_MODE]);

export function normalizeMode(mode) {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  return ALLOWED_MODES.has(normalized) ? normalized : '';
}

// FIX [AUDIT]: убран FEATURES.LEGACY_FLAG — legacy realtime provider удалён, флаг был всегда false.
// Режим теперь определяется только через env-переменные.
// Если ни VITE_RUNTIME_MODE, ни VITE_MODE не заданы — демо-режим (безопасный дефолт).
export function resolveRuntimeMode(env = (import.meta?.env ?? {})) {
  // Приоритет: VITE_RUNTIME_MODE → VITE_MODE → demo
  const runtimeMode = normalizeMode(env.VITE_RUNTIME_MODE);
  if (runtimeMode) return runtimeMode;

  const appMode = normalizeMode(env.VITE_MODE);
  if (appMode) return appMode;

  return DEMO_MODE;
}

/**
 * Единая точка определения режима приложения.
 * live  — реальный backend (VITE_RUNTIME_MODE=live в .env)
 * demo  — локальные данные без сервера (дефолт)
 */
export const MODE = resolveRuntimeMode();
export const isLiveMode = () => MODE === LIVE_MODE;
export const isDemoMode = () => MODE === DEMO_MODE;
