/**
 * platform-v1 role-based route gate.
 *
 * Three states:
 *   - session loading  → <Spinner> (no flicker on refresh)
 *   - session error unauthorized → redirect to /login (legacy login UI)
 *   - session ready, role mismatch → <Navigate to="/" replace> (home)
 *
 * Components that need the role only use <RoleGate allow={['admin']}>.
 */

import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { normalizeUserRole, useV1SessionState } from '../store';
import type { UserRole } from '../api/types';
import { Spinner, Stack } from './ui';

export interface RoleGateProps {
  allow: readonly UserRole[];
  children: ReactNode;
  /** Where to send disallowed roles. Default: home. */
  fallback?: string;
}

export function RoleGate({ allow, children, fallback = '/' }: RoleGateProps) {
  const { status, user, error } = useV1SessionState();

  if (status === 'loading') {
    return (
      <Stack className="v1-loading-shell">
        <Spinner />
        <span>Загрузка сессии…</span>
      </Stack>
    );
  }

  if (status === 'error') {
    if (error?.kind === 'unauthorized') {
      // Legacy /login owns the auth flow; go there.
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
      return null;
    }
    return (
      <Stack>
        <p>Не удалось загрузить сессию: {error?.message ?? 'неизвестная ошибка'}</p>
      </Stack>
    );
  }

  if (!user) return <Navigate to={fallback} replace />;
  const normalizedUserRole = normalizeUserRole(user.role);
  const normalizedAllow = allow.map(normalizeUserRole);
  if (!normalizedAllow.includes(normalizedUserRole)) return <Navigate to={fallback} replace />;

  return <>{children}</>;
}
