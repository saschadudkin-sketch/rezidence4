import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { canManageRequests } from '../domain/permissions';
import { canAccessTab } from '../domain/permissions';
import { getRoleManifest, ROLE_MANIFEST } from '../domain/roleManifest';
import { STORAGE_KEYS, writeStorage } from '../store/persistence/storageRegistry';
import { toast } from '../ui/Toasts';
import { emitUxMetric, UX_METRICS } from '../utils/telemetryContract';

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
  const redirectNoticeRef = useRef('');
  const knownTabs = useRef(new Set(Object.values(ROLE_MANIFEST).flatMap((m) => m.tabs)));

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
      if (tabFromUrl) {
        const noticeKey = `${user.role}:${tabFromUrl}:${defaultTab}`;
        if (redirectNoticeRef.current !== noticeKey) {
          redirectNoticeRef.current = noticeKey;
          emitUxMetric(UX_METRICS.NAV_FORBIDDEN_REDIRECT, {
            role: user.role,
            from: tabFromUrl,
            to: defaultTab,
            reason: knownTabs.current.has(tabFromUrl) ? 'forbidden' : 'invalid',
          });
          toast('Раздел недоступен вашей роли. Открыт доступный раздел.', 'warn');
        }
      }
      navigate(`/dashboard/${defaultTab}`, { replace: true });
    }
  }, [validTabFromUrl, tabFromUrl, defaultTab, navigate, user.role]);

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
