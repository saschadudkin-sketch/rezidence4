/**
 * Dashboard.jsx — REACT-1: God Component разбит на хуки.
 * Компонент теперь только верстка + оркестрация хуков.
 *
 * Логика перенесена в src/hooks/useDashboardHooks.js:
 *   useTheme()             — тема
 *   useNavBadges()         — счётчики навигации
 *   useLiveSync()          — SSE синхронизация
 *   usePushNotifications() — push + PWA badge
 *   useArrivalNotifier()   — уведомление о госте
 *   useNavigation()        — активный таб
 */

import { useState, useRef, useMemo, useCallback, useEffect, lazy, Suspense, memo } from 'react';
import {
  useRequests, useChat, useAvatar, useActions, useBlacklist,
} from '../store/AppStore';
import { ROLE_LABELS } from '../constants';
import { canManageRequests } from '../constants/requestPredicates.js';
import { ROLES, getTabsForRole } from '../domain/permissions';
import { AvatarCircle } from '../ui/AvatarCircle';
import { AppIcon } from '../ui/AppIcon';
import { AvatarModal } from '../ui/Modals';
import { toast } from '../ui/Toasts';
import ErrorBoundary from '../ui/ErrorBoundary';
import { LOGO } from '../constants/logo';
import { isDemoMode } from '../config/runtimeMode.js';
import { useScheduledActivation } from '../hooks/useScheduledActivation';
import {
  useTheme,
  useNavBadges,
  useLiveSync,
  usePushNotifications,
  useArrivalNotifier,
  useNavigation,
} from '../hooks/useDashboardHooks';
// FIX [R3]: Lazy-load role-specific views — они не попадают в основной бандл,
// если пользователь — резидент (не видит GuardPostMode) или охрана (не видит AdminView).
const ResidentView  = lazy(() => import('./ResidentView'));
const ConciergeView = lazy(() => import('./SecurityConciergeViews').then(m => ({ default: m.ConciergeView })));
const SecurityView  = lazy(() => import('./SecurityConciergeViews').then(m => ({ default: m.SecurityView })));

const AdminView = lazy(() => import('./AdminView'));

// ─── Статичные стили (вне компонента — не пересоздаются при рендере) ─────────
// REACT-3: inline-объекты в JSX заменены на константы
const BADGE_STYLE = {
  position: 'absolute', top: -3, right: -3,
  background: 'var(--err)', color: 'var(--err-t)',
  fontSize: 11, fontWeight: 700, minWidth: 15, height: 15,
  borderRadius: 8, display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: '0 3px', border: '1.5px solid var(--bg)',
};
const AVATAR_STYLE = { background: 'transparent', padding: 0, border: 'none' };
const ADMIN_LOADING_STYLE = { textAlign: 'center', padding: 40, color: 'var(--t4)' };

// FIX [PERF]: PAGE_T/PAGE_S как модульные константы (lookup-only, not recreated each render)
const PAGE_TITLES = {
  owner: 'Добро пожаловать', tenant: 'Добро пожаловать',
  contractor: 'Панель подрядчика', concierge: 'Рабочее место',
  security: 'Пост охраны', admin: 'Управление',
};
const PAGE_SUBTITLES = {
  contractor: 'Управление пропусками', concierge: 'Контроль и координация',
  security: 'Контроль доступа', admin: 'Резиденции Замоскворечья',
};

// ─── RenderContent — мемоизирован ─────────────────────────────────────────────
// REACT-4: React.memo предотвращает ре-рендер при изменении несвязанного состояния
const RenderContent = memo(function RenderContent({
  user, activeTab, setActiveTab, highlightReqId, setHighlightReqId,
}) {
  // FIX [R3]: все role-specific views теперь lazy — нужен Suspense
  const fallback = <div style={ADMIN_LOADING_STYLE}>Загрузка...</div>;

  if (user.role === ROLES.SECURITY) {
    return (
      <Suspense fallback={fallback}>
        <SecurityView
          user={user} activeTab={activeTab} setActiveTab={setActiveTab}
          highlightReqId={highlightReqId} setHighlightReqId={setHighlightReqId}
        />
      </Suspense>
    );
  }
  if (user.role === ROLES.CONCIERGE) {
    return (
      <Suspense fallback={fallback}>
        <ConciergeView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
      </Suspense>
    );
  }
  if (user.role === ROLES.ADMIN) {
    return (
      <Suspense fallback={fallback}>
        <AdminView user={user} activeTab={activeTab} />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={fallback}>
      <ResidentView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
    </Suspense>
  );
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard({ user, onLogout }) {
  const requests  = useRequests();
  const blacklist = useBlacklist();
  const { chat, chatLastSeen } = useChat();
  const avData    = useAvatar(user.uid);
  const {
    setAvatar, deleteAvatar,
    setAllRequests, setAllMessages, setAllUsers,
    setPerms, setTemplates, setBlacklist,
    markChatSeen, activateScheduled,
  } = useActions();

  const [menuOpen, setMenuOpen] = useState(false);
  const [avOpen,   setAvOpen]   = useState(false);

  // ── Хуки (вся бизнес-логика здесь) ─────────────────────────────────────
  const { cycleTheme, themeIcon, themeLabel } = useTheme();

  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  // Ref-ы для отслеживания предыдущих значений (нужны внутри useLiveSync)
  const prevPendingP = useRef(0);
  const prevPendingT = useRef(0);
  const prevMsgs     = useRef(0);

  // FIX [UX]: isLoading — пока SSE не прислал первый пакет, показываем skeleton.
  // Добавлен timeout 8с: если данные не пришли (сеть, ошибка соединения) —
  // снимаем skeleton принудительно, чтобы не блокировать интерфейс навсегда.
  //
  // FIX [REACT]: убран антипаттерн "derive state from props через useEffect".
  // Было: useState(syncLoading) + useEffect(() => setIsLoading(syncLoading)) —
  //   лишний рендер при каждом изменении syncLoading, дублирование состояния.
  // Стало: timedOut флаг + вычисляемый isLoading — нет дублирования, нет лишних рендеров.
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
  const isLoading = syncLoading && !timedOut;

  usePushNotifications(user, { pendingT, pendingP, unreadMsgs });
  useArrivalNotifier(user, requests);
  useScheduledActivation(requests, activateScheduled);

  const { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId } =
    useNavigation(user, { markChatSeen, onPassesSeen });

  // ── Аватарка ─────────────────────────────────────────────────────────────
  // FIX [PERF]: useCallback — saveAvatar передаётся в AvatarModal,
  // без memo пересоздаётся при каждом рендере Dashboard (badge обновления и т.д.)
  const saveAvatar = useCallback(av => {
    if (av) setAvatar(user.uid, av);
    else    deleteAvatar(user.uid);
    toast(av ? 'Аватарка сохранена' : 'Аватарка удалена', 'success');
  }, [setAvatar, deleteAvatar, user.uid]);

  // ── Навигация ─────────────────────────────────────────────────────────────
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

  const NAV = useMemo(
    () => getTabsForRole(user.role).map(tab => [tab, ...(NAV_META[tab] || ['list', tab, 0])]),
    [user.role, NAV_META],
  );

  // FIX [PERF]: PAGE_T/S lookup maps вынесены (ниже как константы) — не создаются при рендере
  const PAGE_T = PAGE_TITLES[user.role];
  const PAGE_S = user.role === 'owner' || user.role === 'tenant'
    ? 'Апартаменты ' + user.apartment
    : (PAGE_SUBTITLES[user.role] || '');

  // FIX [PERF]: navBtnClass вызывался 2 раза на кнопку (top + mobile nav).
  // Мемоизируем результат в Map — вычисляем один раз при изменении зависимостей.
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
      // FIX [PERF]: pre-compute both variants — mobile nav не вызывает .replace() при каждом рендере
      map[k]         = modifiers ? `tn-btn ${modifiers}` : 'tn-btn';
      map[k + '_mn'] = modifiers ? `mn-btn ${modifiers}` : 'mn-btn';
    }
    return map;
  }, [user.role, activeTab, pendingT, pendingP, unreadMsgs]);
  const navBtnClass   = (k) => navClassMap[k]        || 'tn-btn';
  const navBtnClassMn = (k) => navClassMap[k + '_mn'] || 'mn-btn';

  // ── Render ────────────────────────────────────────────────────────────────
  // FIX [UX]: показываем skeleton пока isLoading=true (первый пакет от SSE не пришёл).
  // Ранее: пустые списки ~300-600мс без индикации — выглядело как баг.
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

  return (
    <>
      <div onClick={() => menuOpen && setMenuOpen(false)}>
        <header className="header">
          <div className="header-inner">
            <div className="header-brand">
              <img src={LOGO} alt="" className="header-logo" />
              <span className="header-wordmark">Резиденции Замоскворечья</span>
              {isDemoMode() && <span className="demo-badge" title="Демо-режим: данные хранятся только локально">DEMO</span>}
            </div>
            <div className="header-actions">
              <button className="theme-btn" onClick={cycleTheme} title="Переключить тему" aria-label={'Тема: ' + themeLabel}>
                <span><AppIcon name={themeIcon} size={14} /></span>
                <span>{themeLabel}</span>
              </button>
              <div
                className="header-user" role="button" tabIndex={0}
                aria-label="Меню пользователя" aria-expanded={menuOpen}
                onClick={e => { e.stopPropagation(); setMenuOpen(o => !o); }}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMenuOpen(o => !o))}
              >
                <div className="header-info">
                  <div className="header-name">{user.name}</div>
                  <div className="header-role">{ROLE_LABELS[user.role]}</div>
                </div>
                <div className="u-rel">
                  <div className="header-avatar" style={AVATAR_STYLE}>
                    <AvatarCircle avData={avData} role={user.role} name={user.name} size={34} fontSize={14} />
                  </div>
                  {canManageRequests(user.role) && (pendingT + pendingP) > 0 && (
                    <span style={BADGE_STYLE}>{pendingT + pendingP}</span>
                  )}
                </div>
                {menuOpen && (
                  <div className="dropdown" onClick={e => e.stopPropagation()}>
                    <div className="dd-avatar-wrap" onClick={e => e.stopPropagation()}>
                      <div
                        style={{ cursor: 'pointer', position: 'relative' }}
                        role="button" tabIndex={0}
                        onClick={() => { setMenuOpen(false); setAvOpen(true); }}
                        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setMenuOpen(false), setAvOpen(true))}
                        aria-label="Изменить аватарку"
                      >
                        <div className="dd-avatar-big" style={AVATAR_STYLE}>
                          <AvatarCircle avData={avData} role={user.role} name={user.name} size={56} fontSize={22} />
                          <div className="dd-avatar-overlay"><AppIcon name="camera" size={14} /></div>
                        </div>
                      </div>
                      <div className="dd-user-info">
                        <div className="dd-user-name">{user.name}</div>
                        <div className="dd-user-phone">{user.phone}</div>
                      </div>
                      <button className="dd-upload-btn" onClick={() => { setMenuOpen(false); setAvOpen(true); }}>
                        Настроить аватарку
                      </button>
                    </div>
                    <button className="dd-out" onClick={onLogout}>Выйти из аккаунта</button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="layout">
          <nav className="top-nav">
            {NAV.map(([k, icon, label, badge]) => (
              <button key={k} className={navBtnClass(k)} onClick={() => goTab(k)}>
                <span className="tn-icon"><AppIcon name={icon} size={15} /></span>
                <span>{label}</span>
                {badge > 0 && <span className="tn-badge">{badge}</span>}
              </button>
            ))}
          </nav>
          <main className="content">
            {activeTab !== 'chat' && (
              <div className="page-top">
                <div>
                  <h1 className="page-title">{PAGE_T}</h1>
                  <p className="page-sub">{PAGE_S}</p>
                </div>
              </div>
            )}
            <ErrorBoundary name="Экран">
              <RenderContent
                user={user}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                highlightReqId={highlightReqId}
                setHighlightReqId={setHighlightReqId}
              />
            </ErrorBoundary>
          </main>
        </div>

        <nav className="mobile-nav">
          {NAV.map(([k, icon, label, badge]) => (
            <button key={k} className={navBtnClassMn(k)} onClick={() => goTab(k)}>
              <span className="mn-icon"><AppIcon name={icon} size={16} /></span>
              <span className="mn-label">{label}</span>
              {badge > 0 && <span className="mn-dot" />}
            </button>
          ))}
        </nav>
      </div>

      {avOpen && <AvatarModal user={user} avatar={avData} onSave={saveAvatar} onClose={() => setAvOpen(false)} />}
    </>
  );
}
