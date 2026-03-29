import { useState, useEffect, useCallback } from 'react';
import { canManageRequests } from '../constants/requestPredicates';
import { canAccessTab, getTabsForRole } from '../domain/permissions';

/**
 * useNavigation — управление активным табом и переходами между ними.
 * Сбрасывает счётчики при переходе на соответствующие вкладки.
 */
export function useNavigation(user, { markChatSeen, onPassesSeen }) {
  const defaultTab = {
    owner: 'passes', tenant: 'passes', contractor: 'passes',
    concierge: 'passes', security: 'guardpost', admin: 'stats',
  }[user.role] || 'passes';

  const [activeTab,      setActiveTab]      = useState(defaultTab);
  const [highlightReqId, setHighlightReqId] = useState(null);

  // Если роль изменилась и текущий таб недоступен — сбрасываем на первый доступный
  useEffect(() => {
    if (!canAccessTab(user.role, activeTab)) {
      const tabs = getTabsForRole(user.role);
      setActiveTab(tabs[0] || 'passes');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role]);

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
  }, [user.role, user.uid, markChatSeen, onPassesSeen]);

  return { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId };
}
