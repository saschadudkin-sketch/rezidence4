import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { api, setToken, STORAGE_KEY, ApiError } from './api';

/**
 * admin/auth — auth state for the platform superadmin SPA.
 *
 * Tokens are plain JWTs held in localStorage.  We deliberately don't persist
 * the admin profile: on every reload we hit GET /stats (a cheap call behind
 * the same platformAuth guard) to verify the token still works, and only
 * then mark the session as authenticated.  A 401 response from `api` wipes
 * the stored token automatically (see api.ts), so we just observe the error
 * here and drop back to the login screen.
 */

export interface PlatformAdmin {
  id: string;
  email: string;
  name: string;
}

interface AuthContextValue {
  admin: PlatformAdmin | null;
  status: 'loading' | 'authenticated' | 'unauthenticated';
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface LoginResponse {
  token: string;
  admin: PlatformAdmin;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [status, setStatus] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [error, setError] = useState<string | null>(null);

  // On mount: if a token is present, verify it by calling a protected endpoint.
  // If it works, we consider the session live; if it 401s, api.ts has already
  // wiped the token and we land on the login page.
  useEffect(() => {
    let cancelled = false;

    async function verify() {
      const token = (() => { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } })();
      if (!token) {
        if (!cancelled) setStatus('unauthenticated');
        return;
      }
      try {
        // /stats is one of the lightest platformAuth-guarded calls; verifying
        // here means we don't render the admin shell only to fail every page.
        await api.get('/stats');
        if (cancelled) return;
        // We don't have a /me endpoint for platform admins — synthesise a
        // minimal profile.  Name/email will be overwritten on login.
        setAdmin((prev) => prev ?? { id: '', email: '', name: '' });
        setStatus('authenticated');
      } catch {
        if (!cancelled) setStatus('unauthenticated');
      }
    }

    verify();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const res = await api.login<LoginResponse>({ email, password });
      setToken(res.token);
      setAdmin(res.admin);
      setStatus('authenticated');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Не удалось войти';
      setError(msg);
      setStatus('unauthenticated');
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      // Best-effort — we still want to clear local state even if the server
      // call fails (network down, token already expired).
      await api.post('/auth/logout').catch(() => undefined);
    } finally {
      setToken(null);
      setAdmin(null);
      setStatus('unauthenticated');
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ admin, status, error, login, logout }),
    [admin, status, error, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
