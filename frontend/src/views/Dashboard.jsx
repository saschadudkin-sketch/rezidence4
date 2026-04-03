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

import { useState, useRef, useMemo, useEffect } from 'react';
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
import AppShell from './shell/AppShell';

// P-05: one-time demo welcome banner
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
  } = useActions();

  const { cycleTheme, themeIcon, themeLabel } = useTheme();

  // P-05: one-time demo welcome banner
  const [showDemoBanner, setShowDemoBanner] = useState(() =>
    isDemoMode() && !localStorage.getItem(DEMO_WELCOME_KEY)
  );
  const dismissDemoBanner = () => {
    localStorage.setItem(DEMO_WELCOME_KEY, '1');
    setShowDemoBanner(false);
  };

  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  const prevPendingP = useRef(0);
  const prevPendingT = useRef(0);
  // PERF-03: prevMsgs удалён — только инкрементировался, но никогда не сравнивался.
  // Реальный счётчик непрочитанных — из useNavBadges (chat.filter по chatLastSeen).

  const { isLoading: syncLoading, sseOnline } = useLiveSync(user, {
    setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
    prevPendingP, prevPendingT,
  });
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!syncLoading) return;
    const t = setTimeout(() => setTimedOut(true), 8_000);
    return () => clearTimeout(t);
  }, [syncLoading]);
  const isLoading  = syncLoading && !timedOut;
  // UX-002: таймаут соединения — явное состояние ошибки вместо пустого UI
  const isConnErr  = syncLoading && timedOut;

  usePushNotifications(user, { pendingT, pendingP, unreadMsgs });
  useArrivalNotifier(user, requests);
  useScheduledActivation(requests, activateScheduled);

  const { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId } =
    useNavigation(user, { markChatSeen, onPassesSeen });

  // PERF-04: объединены 3 useMemo (NAV_META, nav, navClassMap) в один вызов.
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
      visitlog:  ['history',  'Журнал',     0],
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

  const pageTitle = PAGE_TITLES[user.role];
  const pageSubtitle = user.role === 'owner' || user.role === 'tenant'
    ? 'Апартаменты ' + user.apartment
    : (PAGE_SUBTITLES[user.role] || '');

  if (isLoading) {
    return (
      <div className="screen-loading">
        <div className="screen-loading-inner">
          <div className="screen-loading-spinner"><AppIcon name="history" size={28} /></div>
          <div className="screen-loading-label">Загрузка данных…</div>
        </div>
      </div>
    );
  }

  // UX-002: вместо пустого UI при таймауте — понятный экран ошибки с кнопкой повтора
  if (isConnErr) {
    return (
      <div className="screen-loading">
        <div className="screen-loading-inner">
          <div className="screen-loading-spinner"><AppIcon name="ban" size={28} /></div>
          <div className="screen-loading-label">Не удалось подключиться к серверу</div>
          <div className="screen-loading-sub">Проверьте соединение и попробуйте снова</div>
          <button className="btn-outline screen-loading-retry" onClick={() => window.location.reload()}>
            Обновить страницу
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showDemoBanner && <DemoBanner onClose={dismissDemoBanner} />}
      <AppShell
      user={user}
      onLogout={onLogout}
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      pendingCount={pendingT + pendingP}
      nav={nav}
      navClassMap={navClassMap}
      goTab={goTab}
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      highlightReqId={highlightReqId}
      setHighlightReqId={setHighlightReqId}
      cycleTheme={cycleTheme}
      themeIcon={themeIcon}
      themeLabel={themeLabel}
      sseOnline={sseOnline}
    />
    </>
  );
}
