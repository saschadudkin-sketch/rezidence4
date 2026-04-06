const STORAGE_KEYS = {
  DEMO_WELCOME_SEEN: 'rz:demo-welcome-seen',
  PASSES_SEEN_AT: 'rz-passes-seen',
  RETURN_TO: 'rz:return-to',
} as const;

const STORAGE_PREFIXES = ['rz:', 'rz-', 'residenze_v5'] as const;

export function readStorage(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota/private mode
  }
}

export function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export function clearAppStorage(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}

export function onboardingKey(role: string): string {
  return `rz:onboarding-seen:v1:${role}`;
}

const ONBOARDING_VERSION = 'v2';
const ONBOARDING_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

export function onboardingKeyByUser(uid: string, role: string, version = ONBOARDING_VERSION): string {
  return `rz:onboarding-seen:${version}:${role}:${uid}`;
}

export function isOnboardingSeen(uid: string, role: string, now = Date.now()): boolean {
  const raw = readStorage(onboardingKeyByUser(uid, role));
  if (!raw) return false;
  const ts = Number(raw);
  if (!Number.isFinite(ts)) return false;
  return (now - ts) < ONBOARDING_TTL_MS;
}

export function markOnboardingSeen(uid: string, role: string): void {
  writeStorage(onboardingKeyByUser(uid, role), String(Date.now()));
}

export { STORAGE_KEYS, STORAGE_PREFIXES };
