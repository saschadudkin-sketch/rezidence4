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
import { isDemoMode } from '../config/runtimeMode';
// CQ-03: connection state logic extracted to dedicated hook
import { useConnectionStatus } from '../hooks/useConnectionStatus';
import AppShell from './shell/AppShell';
import { NavigationContext } from './shell/NavigationContext';
// A-01: use centralized event registry
import { onSseForceReconnect } from '../utils/events';
import StateBlock from '../ui/StateBlock';
import { getRoleManifest } from '../domain/roleManifest';


const DEMO_WELCOME_KEY = 'rz:demo-welcome-seen';
function DemoBanner({ onClose }) {
  return (
    <div className="demo-welcome-banner" role="status" aria-live="polite">
      <span className="demo-welcome-icon"><AppIcon name="alert" size={14} /></span>
      <span className="demo-welcome-text">
        <strong>Демо-режим.</strong>{' '}
        Попробуйте создать пропуск или вызов техслужбы — всё работает без сервера.
        Данные сохраняются только в браузере и сбросятся при перезагрузке страницы.
      </span>
      <button className="demo-welcome-close" onClick={onClose} aria-label="Закрыть баннер">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

// P-06: Role-based onboarding hints — shown once per role on first login.
// Dismissed permanently per role using localStorage.
const ONBOARDING_HINT_KEY = (role) => `rz:onboarding-seen:${role}`;
const ONBOARDING_HINTS = {
  [ROLES.OWNER]:       'Нажмите «+» чтобы создать пропуск для гостя, курьера или подрядчика. Пропуска появятся у охраны автоматически.',
  [ROLES.TENANT]:      'Создайте пропуск для гостя или мастера — охрана получит уведомление мгновенно.',
  [ROLES.CONTRACTOR]:  'Здесь ваши рабочие пропуска. Создайте новый, указав марку и номер авто, если планируется въезд.',
  [ROLES.CONCIERGE]:   'Пропуска, ожидающие подтверждения, — в разделе «Заявки». Подтвердите или отклоните каждую.',
  [ROLES.SECURITY]:    'Отсканируйте QR-код гостя или найдите заявку вручную, чтобы зарегистрировать визит.',
  [ROLES.ADMIN]:       'В разделе «Резиденты» управляйте пользователями. Аналитика доступна во вкладке «Аналитика».',
};

function OnboardingHint({ role, onClose }) {
  const hint = ONBOARDING_HINTS[role];
  if (!hint) return null;
  return (
    <div className="onboarding-hint" role="status" aria-live="polite">
      <span className="onboarding-hint-icon"><AppIcon name="info" size={14} /></span>
      <span className="onboarding-hint-text">{hint}</span>
      <button className="onboarding-hint-close" onClick={onClose} aria-label="Закрыть подсказку">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

const TAB_TITLES = {
  passes: 'Пропуска', tech: 'Техслужба', perms: 'Постоянный список',
  templates: 'Шаблоны', history: 'История', chat: 'Чат',
  visitlog: 'Журнал посещений', residents: 'Жильцы', blacklist: 'Чёрный список',
  guardpost: 'Пост охраны', stats: 'Аналитика', requests: 'Заявки', users: 'Резиденты',
};
export default function Dashboard({ user, onLogout, isOnline = true }) {
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

  // P-06: role-based onboarding hint — shown once per role, dismissed to localStorage
  const [showOnboarding, setShowOnboarding] = useState(() =>
    !localStorage.getItem(ONBOARDING_HINT_KEY(user.role))
  );
  const dismissOnboarding = () => {
    localStorage.setItem(ONBOARDING_HINT_KEY(user.role), '1');
    setShowOnboarding(false);
  };

  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  const [retryKey, setRetryKey] = useState(0);

  // DO-02: Listen for watchdog-triggered force reconnect.
  // useLiveSync watchdog emits this when SSE stream is stale for 60s.
  // A-01: use typed helper from centralized event registry (was magic string 'rz:sse-force-reconnect')
  useEffect(() => onSseForceReconnect(() => setRetryKey(k => k + 1)), []);

  const liveSync = useLiveSync(user, {
    setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
    retryKey,
    addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
    // PERF: incremental request SSE updates
    updateRequest, addRequest, deleteRequest,
  });
  // CQ-03: connection state logic in its own hook — Dashboard stays a thin coordinator
  const { isLoading, isConnErr, sseOnline, handleRetry } = useConnectionStatus(liveSync, { retryKey, setRetryKey });

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

  const roleManifest = getRoleManifest(user.role);
  const pageTitle = TAB_TITLES[activeTab] || roleManifest.pageTitle;
  const pageSubtitle = user.role === 'owner' || user.role === 'tenant'
    ? 'Апартаменты ' + user.apartment
    : (roleManifest.pageSubtitle || '');

  if (isConnErr) {
    return (
      <div className="screen-loading">
        <div className="screen-loading-inner">
          <StateBlock
            type="error"
            title="Не удалось подключиться к серверу"
            subtitle="Проверьте соединение и попробуйте снова"
            actionLabel="Попробовать снова"
            onAction={handleRetry}
          />
        </div>
      </div>
    );
  }

  return (
    <NavigationContext.Provider value={{ nav, navClassMap, goTab, activeTab, setActiveTab, highlightReqId, setHighlightReqId }}>
      {showDemoBanner && <DemoBanner onClose={dismissDemoBanner} />}
      {showOnboarding && !showDemoBanner && (
        <OnboardingHint role={user.role} onClose={dismissOnboarding} />
      )}
      {/* P-02: pass isLoading so AppShell renders skeleton cards instead of
          a full-screen spinner — the header and nav are immediately usable */}
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
        isLoading={isLoading}
        isOnline={isOnline}
      />
    </NavigationContext.Provider>
  );
}
