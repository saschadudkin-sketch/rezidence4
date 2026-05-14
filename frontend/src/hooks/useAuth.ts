import { useState, useEffect, useCallback, useRef } from 'react';
import { requestNotifPerm } from '../utils';
import { logger } from '../services/logger';
import { toast } from '../ui/Toasts';
import { isLiveMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
// A-01: use centralized event registry instead of magic string
import { onSessionExpired, onUnauthorized } from '../utils/events';
import { clearAppStorage, STORAGE_KEYS, writeStorage } from '../store/persistence/storageRegistry';
import type { AppUser } from '../store/slices/usersSlice';

// ─── Security model ──────────────────────────────────────────────────────────
// SEC: JWT stored in HttpOnly cookie (not accessible to JS).
// Access token: 15min. Refresh token: 30 days, rotated on each use.
// Session recovery: GET /api/v1/auth/me on app load.
// Auto-logout: 401 from API → emits 'rz:unauthorized' event → setPhase(LOGIN)

// ─── Config ──────────────────────────────────────────────────────────────────

export const APP_CONFIG = {
  splashDelay: 400,
} as const;

export const PHASE = {
  LOADING:   'loading',
  LOGIN:     'login',
  DASHBOARD: 'dashboard',
} as const;

export type AuthPhase = typeof PHASE[keyof typeof PHASE];

export type UseAuthResult = {
  phase: AuthPhase;
  user: AppUser | null;
  login: (user: AppUser) => void;
  logout: () => void;
  authNotice: string;
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth(): UseAuthResult {
  const [phase, setPhase] = useState<AuthPhase>(PHASE.LOADING);
  // FIX [TYPES]: явная типизация — без generic useState(null) имеет тип null,
  // что приводит к any-cast при доступе к user.uid, user.role и т.д.
  const [user,  setUser]  = useState<AppUser | null>(null);
  const [authNotice, setAuthNotice] = useState<string>('');
  const notifTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isLiveMode()) {
      // Live: пробуем восстановить сессию по HttpOnly cookie (/api/v1/auth/me)
      let cancelled = false;
      services.auth.getMe()
        .then((user) => {
          if (cancelled) return;
          if (user && user.uid) {
            setUser(user);
            setPhase(PHASE.DASHBOARD);
            logger.setContext({ uid: user.uid, role: user.role, name: user.name });
          } else {
            setPhase(PHASE.LOGIN);
          }
        })
        .catch((err: unknown) => {
          logger.warn('getMe failed', {
            message: err instanceof Error ? err.message : String(err),
          });
          if (!cancelled) setPhase(PHASE.LOGIN);
        });
      return () => { cancelled = true; };
    }
    // Demo: показываем splash, затем логин
    const t = setTimeout(() => setPhase(PHASE.LOGIN), APP_CONFIG.splashDelay);
    return () => clearTimeout(t);
  }, []);

  // Автологаут при истечении JWT (событие от apiClient)
  // A-01: use typed helper from centralized event registry
  useEffect(() => onUnauthorized(() => {
    setUser(null);
    setPhase(PHASE.LOGIN);
  }), []);
  useEffect(() => onSessionExpired((detail) => {
    if (detail?.returnTo) writeStorage(STORAGE_KEYS.RETURN_TO, detail.returnTo);
    const reasonLabel = detail?.reason === 'refresh_failed' ? 'время входа истекло' : 'сессия завершена';
    setAuthNotice(`Сессия истекла (${reasonLabel}). Войдите снова — мы восстановим ваш последний экран.`);
  }), []);
  useEffect(() => () => {
    if (notifTimerRef.current !== null) {
      window.clearTimeout(notifTimerRef.current);
      notifTimerRef.current = null;
    }
  }, []);

  const login = useCallback((u: AppUser) => {
    if (!u || !u.uid) {
      logger.error('Login called with invalid user', u);
      toast('Ошибка входа', 'error');
      return;
    }
    setUser(u);
    setPhase(PHASE.DASHBOARD);
    setAuthNotice('');
    toast.clearAll?.();
    // FIX [I-19]: defer push notification permission request by 30s after login
    // so the browser dialog appears after the user has seen value, not on first render.
    if (notifTimerRef.current !== null) {
      window.clearTimeout(notifTimerRef.current);
    }
    notifTimerRef.current = window.setTimeout(() => {
      notifTimerRef.current = null;
      requestNotifPerm();
    }, 30_000);
    logger.setContext({ uid: u.uid, role: u.role, name: u.name });
    logger.action('login', { role: u.role });
  }, []);

  const logout = useCallback(() => {
    logger.action('logout');
    logger.clearContext();
    clearAppStorage();
    if (notifTimerRef.current !== null) {
      window.clearTimeout(notifTimerRef.current);
      notifTimerRef.current = null;
    }
    setUser(null);
    setPhase(PHASE.LOGIN);
    setAuthNotice('');
    // В live-режиме: POST /api/auth/logout сбрасывает HttpOnly cookie + SSE disconnect
    // В demo-режиме: только SSE disconnect (нет реального сервера)
    if (isLiveMode()) {
      services.auth.logout().catch((err: unknown) => {
        logger.error('[useAuth] logout request failed', {
          message: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }, []);

  return { phase, user, login, logout, authNotice };
}
