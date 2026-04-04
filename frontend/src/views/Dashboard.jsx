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
import { ROLES, getTabsForRole } from '../domain/permissions';
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
    // FIX [P-1]: incremental SSE updates for blacklist and users (real-time without F5)
    addToBlacklist, removeFromBlacklist,
    updateUser, deleteUser, addUser,
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
  const { isLoading: syncLoading, sseOnline, ssePermanentError } = useLiveSync(user, {
    setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
    retryKey,
    // FIX [P-1]: incremental SSE updates
    addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
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

  // Все три зависели от одного набора значений, теперь одно вычисление вместо трёх.
  const { nav, navClassMap } = useMemo(() => {
    const isSec  = user.role === ROLES.SECURITY;
    const isCon  = user.role === ROLES.CONCIERGE;
    const passesBadge = isSec ? pendingP + pendingT : isCon ? pendingT : residentNewStatuses;
    const NAV_META = {
      passes:    ['ticket', isSec || isCon ? 'Заявки' : 'Пропуска', passesBadge],
      tech:      ['tools',    'Техслужба',  0],
      perms:     ['list',     'Список',     0],
      templates: ['file',     'Шаблоны',    0],
      history:   ['history',  'История',    0],
      chat:      ['chat',     'Чат',        unreadMsgs],
      // UI-04: visitlog used same 'history' icon as history tab — changed to 'list'
      visitlog:  ['list',     'Журнал',     0],
      residents: ['residents','Жильцы',     0],
      blacklist: ['ban',      'ЧС',         blacklistCount],
      guardpost: ['shield',   'Пост',       pendingP],
      stats:     ['chart',    'Аналитика',  0],
      requests:  ['list',     'Заявки',     pendingP + pendingT],
      users:     ['users',    'Резиденты',  0],
    };
    const tabs = getTabsForRole(user.role);
    const nav  = tabs.map(tab => [tab, ...(NAV_META[tab] || ['list', tab, 0])]);
    const map  = {};
    for (const k of tabs) {
      const mods = [
        activeTab === k ? 'active' : '',
        isSec && k === 'passes' && pendingT > 0             && activeTab !== 'passes' ? 'blink'   : '',
        isSec && k === 'passes' && pendingT === 0 && pendingP > 0 && activeTab !== 'passes' ? 'blink-y' : '',
        isCon && k === 'passes' && pendingT > 0             && activeTab !== 'passes' ? 'blink'   : '',
        k === 'chat' && unreadMsgs > 0                      && activeTab !== 'chat'   ? 'blink-y' : '',
      ].filter(Boolean).join(' ');
      map[k]         = mods ? `tn-btn ${mods}` : 'tn-btn';
      map[k + '_mn'] = mods ? `mn-btn ${mods}` : 'mn-btn';
    }
    return { nav, navClassMap: map };
  }, [user.role, activeTab, pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount]);

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
