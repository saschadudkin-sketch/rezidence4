/**
 * platform-v1 session context.
 *
 * Single responsibility: resolve the current user once on mount, expose via
 * hooks, and surface loading/error states for the top-level page shell.
 *
 * Error model: 401 from /auth/me means "please log in" — we don't bounce to
 * /login here because different entry points have different fallbacks (the
 * test harness injects a fake session).  The page shell decides what to do
 * with `session === null && error?.kind === 'unauthorized'`.
 */

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, isV1ApiError } from '../api';
import type { UserMe, UserRole } from '../api/types';
import type { V1ApiError } from '../api/errors';

export interface V1SessionValue {
  readonly status: 'loading' | 'ready' | 'error';
  readonly user: UserMe | null;
  readonly error: V1ApiError | null;
  /** Re-fetches /auth/me — used by retry buttons. */
  readonly refresh: () => Promise<void>;
}

const V1SessionContext = createContext<V1SessionValue | null>(null);

export interface V1SessionProviderProps {
  children: ReactNode;
  /** For tests: skip the network call and seed directly. */
  initialUser?: UserMe;
}

export function V1SessionProvider({ children, initialUser }: V1SessionProviderProps) {
  const [user, setUser] = useState<UserMe | null>(initialUser ?? null);
  const [error, setError] = useState<V1ApiError | null>(null);
  const [status, setStatus] = useState<V1SessionValue['status']>(
    initialUser ? 'ready' : 'loading',
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchMe = useMemo(
    () => async () => {
      setStatus('loading');
      setError(null);
      try {
        const me = await api.session.me();
        if (!mountedRef.current) return;
        setUser(me);
        setStatus('ready');
      } catch (err) {
        if (!mountedRef.current) return;
        if (isV1ApiError(err)) {
          setError(err);
        } else {
          // Fall back to a synthetic error so consumers see a stable shape.
          setError(
            Object.assign(new Error('Unexpected error loading session'), {
              kind: 'unknown',
              status: null,
              payload: null,
              requestId: null,
            }) as unknown as V1ApiError,
          );
        }
        setStatus('error');
        setUser(null);
      }
    },
    [],
  );

  useEffect(() => {
    if (initialUser) return; // test-seeded — do not re-fetch
    void fetchMe();
  }, [fetchMe, initialUser]);

  const value = useMemo<V1SessionValue>(
    () => ({ status, user, error, refresh: fetchMe }),
    [status, user, error, fetchMe],
  );

  return <V1SessionContext.Provider value={value}>{children}</V1SessionContext.Provider>;
}

/**
 * Hook for pages that assume a session is present. Throws when the provider
 * is missing or the user is not yet loaded — use `useV1SessionOpt` if you
 * need to render during the loading state.
 */
export function useV1Session(): UserMe {
  const ctx = useContext(V1SessionContext);
  if (!ctx) throw new Error('useV1Session must be used inside <V1SessionProvider>');
  if (!ctx.user) {
    throw new Error(
      'useV1Session called before session loaded; gate on useV1SessionState().status === "ready"',
    );
  }
  return ctx.user;
}

export function useV1SessionOpt(): UserMe | null {
  const ctx = useContext(V1SessionContext);
  return ctx?.user ?? null;
}

export function useV1SessionState(): V1SessionValue {
  const ctx = useContext(V1SessionContext);
  if (!ctx) throw new Error('useV1SessionState must be used inside <V1SessionProvider>');
  return ctx;
}

// ─── Role predicates ────────────────────────────────────────────────────────

const LEGACY_ROLE_TO_FINAL_ROLE: Readonly<Partial<Record<UserRole, UserRole>>> = {
  owner: 'resident',
  tenant: 'resident',
  admin: 'property_admin',
};

const RESIDENT_ROLES: ReadonlySet<UserRole> = new Set(['resident']);
const STAFF_ROLES: ReadonlySet<UserRole> = new Set([
  'concierge',
  'security',
  'technician',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);
const GUARD_ROLES: ReadonlySet<UserRole> = new Set([
  'security',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);
const CONCIERGE_ROLES: ReadonlySet<UserRole> = new Set([
  'concierge',
  'property_admin',
  'management_company_admin',
  'platform_admin',
]);

export function normalizeUserRole(role: UserRole): UserRole {
  return LEGACY_ROLE_TO_FINAL_ROLE[role] ?? role;
}

export function isResidentRole(role: UserRole): boolean {
  return RESIDENT_ROLES.has(normalizeUserRole(role));
}
export function isStaffRole(role: UserRole): boolean {
  return STAFF_ROLES.has(normalizeUserRole(role));
}
export function isGuardRole(role: UserRole): boolean {
  return GUARD_ROLES.has(normalizeUserRole(role));
}
export function isConciergeRole(role: UserRole): boolean {
  return CONCIERGE_ROLES.has(normalizeUserRole(role));
}
