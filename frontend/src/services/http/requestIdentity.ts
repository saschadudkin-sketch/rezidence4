export function getCsrfToken() {
  try {
    const match = document.cookie.match(/(?:^|;\s*)rz-csrf=([^;]+)/);
    return match ? match[1] : '';
  } catch {
    return '';
  }
}

export function makeRequestId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `rz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
