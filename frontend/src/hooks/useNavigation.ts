import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { canManageRequests } from '../domain/permissions';
import { canAccessTab, getTabsForRole } from '../domain/permissions';
import { getRoleManifest } from '../domain/roleManifest';

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

  const [activeTab,      setActiveTabState] = useState(validTabFromUrl || defaultTab);
  const [highlightReqId, setHighlightReqId] = useState(null);

  // Предотвращаем бесконечный цикл navigate при синхронизации
  const navigatingRef = useRef(false);

  // При монтировании: если URL не содержит валидный таб — перенаправляем
  useEffect(() => {
    if (!validTabFromUrl) {
      navigate(`/dashboard/${activeTab}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Синхронизируем state ← URL при браузерной навигации (Back / Forward)
  useEffect(() => {
    if (navigatingRef.current) { navigatingRef.current = false; return; }
    const t = getTabFromPath(location.pathname);
    if (t && canAccessTab(user.role, t) && t !== activeTab) {
      setActiveTabState(t);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Если роль изменилась и текущий таб недоступен — сбрасываем на первый доступный
  useEffect(() => {
    if (!canAccessTab(user.role, activeTab)) {
      const tabs = getTabsForRole(user.role);
      const next = tabs[0] || 'passes';
      setActiveTabState(next);
      navigate(`/dashboard/${next}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role]);

  // setActiveTab обновляет и state, и URL
  const setActiveTab = useCallback((k) => {
    navigatingRef.current = true;
    setActiveTabState(k);
    navigate(`/dashboard/${k}`, { replace: false });
  }, [navigate]);

  const goTab = useCallback((k) => {
    if (!canAccessTab(user.role, k)) return;
    if (k === 'passes' && !canManageRequests(user.role)) {
      try {
        localStorage.setItem('rz-passes-seen', Date.now().toString());
        // BUG-16: storage event не стреляет в той же вкладке — уведомляем явно
        onPassesSeen?.();
      } catch { /* quota */ }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]); // re-run when searchParams change so in-session deep links work

  return { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId };
}
