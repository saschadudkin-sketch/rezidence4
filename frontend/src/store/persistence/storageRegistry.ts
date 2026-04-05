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
  return `rz:onboarding-seen:${role}`;
}

export { STORAGE_KEYS, STORAGE_PREFIXES };
