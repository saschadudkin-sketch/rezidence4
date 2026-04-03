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
import AppShell from './shell/AppShell';

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

  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  const prevPendingP = useRef(0);
  const prevPendingT = useRef(0);
  const prevMsgs     = useRef(0);

  const { isLoading: syncLoading } = useLiveSync(user, {
    setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
    prevPendingP, prevPendingT, prevMsgs,
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

  const NAV_META = useMemo(() => ({
    passes:    ['ticket', user.role === ROLES.SECURITY || user.role === ROLES.CONCIERGE ? 'Заявки' : 'Пропуска',
                user.role === ROLES.SECURITY ? pendingP + pendingT : user.role === ROLES.CONCIERGE ? pendingT : residentNewStatuses],
    tech:      ['tools', 'Техслужба', 0],
    perms:     ['list', 'Список', 0],
    templates: ['file', 'Шаблоны', 0],
    history:   ['history', 'История', 0],
    chat:      ['chat', 'Чат', unreadMsgs],
    visitlog:  ['history', 'Журнал', 0],
    residents: ['residents', 'Жильцы', 0],
    blacklist: ['ban', 'ЧС', blacklistCount],
    guardpost: ['shield', 'Пост', pendingP],
    stats:     ['chart', 'Аналитика', 0],
    requests:  ['list', 'Заявки', pendingP + pendingT],
    users:     ['users', 'Резиденты', 0],
  }), [user.role, pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount]);

  const nav = useMemo(
    () => getTabsForRole(user.role).map(tab => [tab, ...(NAV_META[tab] || ['list', tab, 0])]),
    [user.role, NAV_META],
  );

  const pageTitle = PAGE_TITLES[user.role];
  const pageSubtitle = user.role === 'owner' || user.role === 'tenant'
    ? 'Апартаменты ' + user.apartment
    : (PAGE_SUBTITLES[user.role] || '');

  const navClassMap = useMemo(() => {
    const map = {};
    const tabs = getTabsForRole(user.role);
    for (const k of tabs) {
      const modifiers = [
        activeTab === k ? 'active' : '',
        user.role === ROLES.SECURITY  && k === 'passes' && pendingT > 0 && activeTab !== 'passes' ? 'blink'   : '',
        user.role === ROLES.SECURITY  && k === 'passes' && pendingT === 0 && pendingP > 0 && activeTab !== 'passes' ? 'blink-y' : '',
        user.role === ROLES.CONCIERGE && k === 'passes' && pendingT > 0 && activeTab !== 'passes' ? 'blink' : '',
        k === 'chat' && unreadMsgs > 0 && activeTab !== 'chat' ? 'blink-y' : '',
      ].filter(Boolean).join(' ');
      map[k]         = modifiers ? `tn-btn ${modifiers}` : 'tn-btn';
      map[k + '_mn'] = modifiers ? `mn-btn ${modifiers}` : 'mn-btn';
    }
    return map;
  }, [user.role, activeTab, pendingT, pendingP, unreadMsgs]);

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
    />
  );
}
