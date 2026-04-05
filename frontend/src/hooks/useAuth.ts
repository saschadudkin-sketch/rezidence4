import { useState, useEffect, useCallback } from 'react';
import { requestNotifPerm } from '../utils';
import { logger } from '../services/logger';
import { toast } from '../ui/Toasts';
import { isLiveMode } from '../config/runtimeMode';
import { services } from '../services/providers/serviceContainer';
// A-01: use centralized event registry instead of magic string
import { onSessionExpired, onUnauthorized } from '../utils/events';
import { clearAppStorage, STORAGE_KEYS, writeStorage } from '../store/persistence/storageRegistry';

// ─── Security model ──────────────────────────────────────────────────────────
// SEC: JWT stored in HttpOnly cookie (not accessible to JS).
// Access token: 15min. Refresh token: 30 days, rotated on each use.
// Session recovery: GET /api/auth/me on app load.
// Auto-logout: 401 from API → emits 'rz:unauthorized' event → setPhase(LOGIN)

// ─── Config ──────────────────────────────────────────────────────────────────

export const APP_CONFIG = {
  splashDelay: 400,
};

export const PHASE = {
  LOADING:   'loading',
  LOGIN:     'login',
  DASHBOARD: 'dashboard',
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useAuth() {
  const [phase, setPhase] = useState(PHASE.LOADING);
  const [user,  setUser]  = useState(null);
  const [authNotice, setAuthNotice] = useState('');

  useEffect(() => {
    if (isLiveMode()) {
      // Live: пробуем восстановить сессию по HttpOnly cookie (/api/auth/me)
      let cancelled = false;
      services.auth.getMe()
        .then(u => {
          if (cancelled) return;
          if (u && u.uid) {
            setUser(u);
            setPhase(PHASE.DASHBOARD);
            logger.setContext({ uid: u.uid, role: u.role, name: u.name });
          } else {
            setPhase(PHASE.LOGIN);
          }
        })
        .catch((err) => {
          logger.warn('getMe failed', { message: err?.message });
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

  const login = useCallback((u) => {
    if (!u || !u.uid) {
      logger.error('Login called with invalid user', u);
      toast('Ошибка входа', 'error');
      return;
    }
    setUser(u);
    setPhase(PHASE.DASHBOARD);
    setAuthNotice('');
    toast('Добро пожаловать, ' + u.name + '!', 'success');
    // FIX [I-19]: defer push notification permission request by 30s after login
    // so the browser dialog appears after the user has seen value, not on first render.
    setTimeout(requestNotifPerm, 30_000);
    logger.setContext({ uid: u.uid, role: u.role, name: u.name });
    logger.action('login', { role: u.role });
  }, []);

  const logout = useCallback(() => {
    logger.action('logout');
    logger.clearContext();
    setUser(null);
    setPhase(PHASE.LOGIN);
    setAuthNotice('');
    // В live-режиме: POST /api/auth/logout сбрасывает HttpOnly cookie + SSE disconnect
    // В demo-режиме: только SSE disconnect (нет реального сервера)
    if (isLiveMode()) {
      services.auth.logout().catch(() => {});
    } else {
      // SECURITY: очищаем PII из localStorage при выходе в demo-режиме
      // SEC-02: охватываем все префиксы: rz: / rz- (UI keys) + residenze_v5 (persistence slices)
      clearAppStorage();
    }
  }, []);

  return { phase, user, login, logout, authNotice };
}
