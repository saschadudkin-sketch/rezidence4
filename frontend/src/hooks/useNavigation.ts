import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { canManageRequests } from '../domain/permissions';
import { canAccessTab } from '../domain/permissions';
import { getRoleManifest } from '../domain/roleManifest';
import { STORAGE_KEYS, writeStorage } from '../store/persistence/storageRegistry';

/**
 * useNavigation — URL-based tab navigation (UX-001).
 *
 * Таб хранится в URL: /dashboard/passes, /dashboard/chat и т.д.
 * Кнопки «Назад» / «Вперёд» в браузере корректно переключают разделы.
 * Ссылки на конкретный раздел можно копировать и передавать.
 */
export function useNavigation(user, { markChatSeen, onPassesSeen }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const defaultTab = getRoleManifest(user.role).defaultTab;

  // Извлекаем таб из URL: /dashboard/passes → 'passes'
  const getTabFromPath = (pathname) => {
    const segments = pathname.split('/').filter(Boolean);
    // ожидаем /dashboard/<tab>
    return segments.length >= 2 && segments[0] === 'dashboard' ? segments[1] : null;
  };

  const tabFromUrl = getTabFromPath(location.pathname);
  const validTabFromUrl = tabFromUrl && canAccessTab(user.role, tabFromUrl) ? tabFromUrl : null;

  const activeTab = validTabFromUrl || defaultTab;
  const [highlightReqId, setHighlightReqId] = useState(null);

  // URL — единственный source of truth для activeTab.
  // Если URL невалидный/недоступный для роли — мягко редиректим на default.
  useEffect(() => {
    if (!validTabFromUrl) {
      navigate(`/dashboard/${defaultTab}`, { replace: true });
    }
  }, [validTabFromUrl, defaultTab, navigate]);

  // URL-only navigation API
  const setActiveTab = useCallback((k) => {
    if (!canAccessTab(user.role, k)) return;
    if (k === activeTab) return;
    navigate(`/dashboard/${k}`, { replace: false });
  }, [user.role, activeTab, navigate]);

  const goTab = useCallback((k) => {
    if (!canAccessTab(user.role, k)) return;
    if (k === 'passes' && !canManageRequests(user.role)) {
      writeStorage(STORAGE_KEYS.PASSES_SEEN_AT, Date.now().toString());
      // BUG-16: storage event не стреляет в той же вкладке — уведомляем явно
      onPassesSeen?.();
    }
    if (k === 'chat') markChatSeen(user.uid);
    setActiveTab(k);
  }, [user.role, user.uid, markChatSeen, onPassesSeen, setActiveTab]);

  // P-07: при переходе из push-уведомления (?reqId=xxx) — открываем нужную заявку.
  // Используем useSearchParams вместо window.location для совместимости с React Router.
  useEffect(() => {
    const reqId = searchParams.get('reqId');
    if (!reqId) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('reqId');
    setSearchParams(nextParams, { replace: true }); // удаляем только reqId, сохраняя остальные query params
    setHighlightReqId(reqId);
    setActiveTab('passes');
  }, [searchParams, setSearchParams, setActiveTab]); // re-run when searchParams change so in-session deep links work

  return { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId };
}
