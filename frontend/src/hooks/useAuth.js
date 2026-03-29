import { useState, useEffect, useCallback } from 'react';
import { requestNotifPerm } from '../utils';
import { logger } from '../services/logger';
import { toast } from '../ui/Toasts';
import { isLiveMode } from '../config/runtimeMode';
import { authProvider } from '../services/providers/backendProvider';

// ─── Config ──────────────────────────────────────────────────────────────────

export const APP_CONFIG = {
  splashDelay: 1200,
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

  useEffect(() => {
    if (isLiveMode()) {
      // Live: пробуем восстановить сессию по HttpOnly cookie (/api/auth/me)
      let cancelled = false;
      authProvider.getMe()
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
        .catch(() => {
          if (!cancelled) setPhase(PHASE.LOGIN);
        });
      return () => { cancelled = true; };
    }
    // Demo: показываем splash, затем логин
    const t = setTimeout(() => setPhase(PHASE.LOGIN), APP_CONFIG.splashDelay);
    return () => clearTimeout(t);
  }, []);

  // Автологаут при истечении JWT (событие от apiClient)
  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setPhase(PHASE.LOGIN);
    };
    window.addEventListener('rz:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('rz:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback((u) => {
    if (!u || !u.uid) {
      logger.error('Login called with invalid user', u);
      toast('Ошибка входа', 'error');
      return;
    }
    setUser(u);
    setPhase(PHASE.DASHBOARD);
    toast('Добро пожаловать, ' + u.name + '!', 'success');
    requestNotifPerm();
    logger.setContext({ uid: u.uid, role: u.role, name: u.name });
    logger.action('login', { role: u.role });
  }, []);

  const logout = useCallback(() => {
    logger.action('logout');
    logger.clearContext();
    setUser(null);
    setPhase(PHASE.LOGIN);
    // В live-режиме: POST /api/auth/logout сбрасывает HttpOnly cookie + SSE disconnect
    // В demo-режиме: только SSE disconnect (нет реального сервера)
    if (isLiveMode()) {
      authProvider.logout().catch(() => {});
    } else {
      // FIX [MEMORY]: в demo-режиме тоже закрываем SSE если был открыт
      authProvider.disconnect?.();
    }
  }, []);

  return { phase, user, login, logout };
}
