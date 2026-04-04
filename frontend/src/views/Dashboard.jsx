/**
 * Dashboard.jsx — A-01: Thin coordinator after shell decomposition.
 *
 * Layout + navigation are now in shell/ sub-components:
 *   AppShell           — outer layout (header + content + mobile nav)
 *   NavigationShell    — top-nav and mobile-nav with badge semantics
 *   RoleContentRouter  — lazy role-based view switcher
 *   UserMenu           — header user dropdown + avatar modal
 *
 * Business logic remains in hooks (useDashboardHooks.js):
 *   useTheme()             — theme cycling
 *   useNavBadges()         — navigation badge counts
 *   useLiveSync()          — SSE live sync
 *   usePushNotifications() — push + PWA badge
 *   useArrivalNotifier()   — guest arrival notification
 *   useNavigation()        — active tab management
 */

import { useState, useMemo, useEffect } from 'react';
import {
  useRequests, useChat, useActions, useBlacklist,
} from '../store/AppStore';
import { AppIcon } from '../ui/AppIcon';
import { useScheduledActivation } from '../hooks/useScheduledActivation';
import {
  useTheme,
  useNavBadges,
  useLiveSync,
  usePushNotifications,
  useArrivalNotifier,
  useNavigation,
} from '../hooks/useDashboardHooks';
import { ROLES } from '../domain/permissions';
import { buildNavItems, buildNavClassMap } from '../domain/navigation';
import { isDemoMode } from '../config/runtimeMode.js';
import { FIRST_CONNECT_TIMEOUT_MS, RECONNECT_TIMEOUT_MS } from '../constants/limits';
import AppShell from './shell/AppShell';
import { NavigationContext } from './shell/NavigationContext';


const DEMO_WELCOME_KEY = 'rz:demo-welcome-seen';
function DemoBanner({ onClose }) {
  return (
    <div className="demo-welcome-banner" role="status" aria-live="polite">
      <span className="demo-welcome-icon"><AppIcon name="alert" size={14} /></span>
      <span className="demo-welcome-text">
        Вы в демо-режиме. Данные хранятся только в браузере и сбрасываются при перезагрузке.
      </span>
      <button className="demo-welcome-close" onClick={onClose} aria-label="Закрыть баннер">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

const PAGE_TITLES = {
  owner: 'Добро пожаловать', tenant: 'Добро пожаловать',
  contractor: 'Панель подрядчика', concierge: 'Рабочее место',
  security: 'Пост охраны', admin: 'Управление',
};
const TAB_TITLES = {
  passes: 'Пропуска', tech: 'Техслужба', perms: 'Постоянный список',
  templates: 'Шаблоны', history: 'История', chat: 'Чат',
  visitlog: 'Журнал посещений', residents: 'Жильцы', blacklist: 'Чёрный список',
  guardpost: 'Пост охраны', stats: 'Аналитика', requests: 'Заявки', users: 'Резиденты',
};
const PAGE_SUBTITLES = {
  contractor: 'Управление пропусками', concierge: 'Контроль и координация',
  security: 'Контроль доступа', admin: 'Резиденции Замоскворечья',
};

export default function Dashboard({ user, onLogout }) {
  const requests  = useRequests();
  const blacklist = useBlacklist();
  const { chat, chatLastSeen } = useChat();
  const {
    setAllRequests, setAllMessages, setAllUsers,
    setPerms, setTemplates, setBlacklist,
    markChatSeen, activateScheduled,
    addToBlacklist, removeFromBlacklist,
    updateUser, deleteUser, addUser,
    // PERF: incremental SSE request updates — точечные действия вместо full REQUESTS_SET_ALL
    updateRequest, addRequest, deleteRequest,
  } = useActions();

  const { cycleTheme, themeIcon, themeLabel } = useTheme();

  
  const [showDemoBanner, setShowDemoBanner] = useState(() =>
    isDemoMode() && !localStorage.getItem(DEMO_WELCOME_KEY)
  );
  const dismissDemoBanner = () => {
    localStorage.setItem(DEMO_WELCOME_KEY, '1');
    setShowDemoBanner(false);
  };

  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  const [retryKey, setRetryKey] = useState(0);

  // DO-02: Listen for watchdog-triggered force reconnect.
  // useLiveSync watchdog emits this when SSE stream is stale for 60s.
  useEffect(() => {
    const handler = () => setRetryKey(k => k + 1);
    window.addEventListener('rz:sse-force-reconnect', handler);
    return () => window.removeEventListener('rz:sse-force-reconnect', handler);
  }, []);

  const { isLoading: syncLoading, sseOnline, ssePermanentError } = useLiveSync(user, {
    setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
    retryKey,
    addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
    // PERF: incremental request SSE updates
    updateRequest, addRequest, deleteRequest,
  });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!syncLoading) { setTimedOut(false); return; }
    const t = setTimeout(
      () => setTimedOut(true),
      retryKey === 0 ? FIRST_CONNECT_TIMEOUT_MS : RECONNECT_TIMEOUT_MS,
    );
    return () => clearTimeout(t);
  }, [syncLoading, retryKey]);
  const isLoading  = syncLoading && !timedOut;
  const isConnErr  = (syncLoading && timedOut) || ssePermanentError;
  const handleRetry = () => { setTimedOut(false); setRetryKey(k => k + 1); };

  usePushNotifications(user, { pendingT, pendingP, unreadMsgs });
  useArrivalNotifier(user, requests);
  useScheduledActivation(requests, activateScheduled);

  const { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId } =
    useNavigation(user, { markChatSeen, onPassesSeen });

  // Navigation items и CSS-классы вычисляются через domain/navigation.js.
  // Логика вынесена из компонента — тестируема без React, Dashboard остаётся тонким координатором.
  const badgesForNav = useMemo(
    () => ({ pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount }),
    [pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount],
  );
  const navItems   = useMemo(() => buildNavItems(user.role, badgesForNav),   [user.role, badgesForNav]);
  const navClassMap = useMemo(() => buildNavClassMap(user.role, activeTab, badgesForNav), [user.role, activeTab, badgesForNav]);
  // NavigationShell ожидает nav как массив [tab, icon, label, badge]
  const nav = useMemo(() => navItems.map(({ tab, icon, label, badge }) => [tab, icon, label, badge]), [navItems]);

  const pageTitle = TAB_TITLES[activeTab] || PAGE_TITLES[user.role];
  const pageSubtitle = user.role === 'owner' || user.role === 'tenant'
    ? 'Апартаменты ' + user.apartment
    : (PAGE_SUBTITLES[user.role] || '');

  if (isLoading) {
    return (
      <div className="screen-loading">
        <div className="screen-loading-inner">
          {/* UI-02: CSS spin animation — semantically correct loader (was "history" icon).
              animation:none overrides screen-loading-spinner's own spin so only btn-spin rotates. */}
          <div className="screen-loading-spinner screen-loading-spinner--no-anim" aria-hidden="true">
            <span className="btn-spin btn-spin--lg" />
          </div>
          <div className="screen-loading-label">Загрузка данных…</div>
        </div>
      </div>
    );
  }

  
  if (isConnErr) {
    return (
      <div className="screen-loading">
        <div className="screen-loading-inner">
          <div className="screen-loading-spinner"><AppIcon name="ban" size={28} /></div>
          <div className="screen-loading-label">Не удалось подключиться к серверу</div>
          <div className="screen-loading-sub">Проверьте соединение и попробуйте снова</div>
          <button className="btn-outline screen-loading-retry" onClick={handleRetry}>
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  return (
    <NavigationContext.Provider value={{ nav, navClassMap, goTab, activeTab, setActiveTab, highlightReqId, setHighlightReqId }}>
      {showDemoBanner && <DemoBanner onClose={dismissDemoBanner} />}
      <AppShell
        user={user}
        onLogout={onLogout}
        pageTitle={pageTitle}
        pageSubtitle={pageSubtitle}
        pendingCount={pendingT + pendingP}
        cycleTheme={cycleTheme}
        themeIcon={themeIcon}
        themeLabel={themeLabel}
        sseOnline={sseOnline}
      />
    </NavigationContext.Provider>
  );
}
