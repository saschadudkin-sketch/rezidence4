const RETURN_TO_KEY = 'rz:return-to';

function currentReturnTarget(): string {
  if (typeof window === 'undefined') return '/v1';
  const { pathname, search, hash } = window.location;
  return `${pathname || '/v1'}${search || ''}${hash || ''}`;
}

export function rememberV1ReturnTarget(): string {
  const target = currentReturnTarget();
  if (target === '/v1' || target.startsWith('/v1/')) {
    try { window.localStorage.setItem(RETURN_TO_KEY, target); } catch { /* non-fatal */ }
  }
  return target;
}

export function redirectUnauthenticatedV1(): void {
  if (typeof window === 'undefined') return;
  rememberV1ReturnTarget();
  if (window.location.pathname !== '/dashboard') {
    window.location.assign('/dashboard');
  }
}
