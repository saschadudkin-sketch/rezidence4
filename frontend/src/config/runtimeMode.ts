export const LIVE_MODE = 'live';
export const DEMO_MODE = 'demo';
export type RuntimeMode = typeof LIVE_MODE | typeof DEMO_MODE;
type NormalizedMode = '' | RuntimeMode;

const ALLOWED_MODES = new Set<RuntimeMode>([LIVE_MODE, DEMO_MODE]);
const TRUE_FLAG_VALUES = new Set<string>(['1', 'true', 'yes', 'on']);
const FALSE_FLAG_VALUES = new Set<string>(['0', 'false', 'no', 'off']);

export function normalizeMode(mode: unknown): NormalizedMode {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  return ALLOWED_MODES.has(normalized as RuntimeMode) ? (normalized as RuntimeMode) : '';
}

export function normalizeBooleanFlag(value: unknown): boolean | null {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (TRUE_FLAG_VALUES.has(normalized)) return true;
  if (FALSE_FLAG_VALUES.has(normalized)) return false;
  return null;
}

export function isDemoEnabled(env: Partial<ImportMetaEnv> = (import.meta?.env ?? {})): boolean {
  const explicitFlag = normalizeBooleanFlag(env.VITE_ENABLE_DEMO);
  if (explicitFlag !== null) return explicitFlag;
  return !env.PROD;
}

// FIX [AUDIT]: убран FEATURES.LEGACY_FLAG — legacy realtime provider удалён, флаг был всегда false.
// Режим теперь определяется только через env-переменные.
// Demo доступен только во внутреннем sandbox:
//   - по умолчанию в dev
//   - в production-like сборках только при VITE_ENABLE_DEMO=true
export function resolveRuntimeMode(env: Partial<ImportMetaEnv> = (import.meta?.env ?? {})): RuntimeMode {
  // Приоритет: VITE_RUNTIME_MODE → VITE_MODE → env-aware default
  const runtimeMode = normalizeMode(env.VITE_RUNTIME_MODE);
  if (runtimeMode) {
    if (runtimeMode === DEMO_MODE && !isDemoEnabled(env)) return LIVE_MODE;
    return runtimeMode;
  }

  const appMode = normalizeMode(env.VITE_MODE);
  if (appMode) {
    if (appMode === DEMO_MODE && !isDemoEnabled(env)) return LIVE_MODE;
    return appMode;
  }

  return isDemoEnabled(env) ? DEMO_MODE : LIVE_MODE;
}

/**
 * Единая точка определения режима приложения.
 * live  — реальный backend (VITE_RUNTIME_MODE=live в .env)
 * demo  — локальные данные без сервера (дефолт)
 */
export const MODE = resolveRuntimeMode();
export const DEMO_ENABLED = isDemoEnabled();
export const isLiveMode = (): boolean => MODE === LIVE_MODE;
export const isDemoMode = (): boolean => MODE === DEMO_MODE;
