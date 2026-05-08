/**
 * AppShell.jsx - App layout shell extracted from Dashboard.
 */

import { memo, useEffect, useState, type ReactNode } from 'react';
import { AppIcon } from '../../ui/AppIcon';
import { LOGO } from '../../constants/logo';
import { isDemoMode } from '../../config/runtimeMode';
import ErrorBoundary from '../../ui/ErrorBoundary';
import UserMenu from './UserMenu';
import NavigationShell from './NavigationShell';
import RoleContentRouter from './RoleContentRouter';
import { useNavigationContext } from './NavigationContext';
import { MEDIA_QUERIES } from '../../constants/breakpoints';
import type { AppUser } from '../../store/slices/usersSlice';

type AppShellProps = {
  user: AppUser;
  onLogout: () => void;
  pageTitle: string;
  pageSubtitle: string;
  pendingCount: number;
  cycleTheme: () => void;
  themeIcon: string;
  themeLabel: string;
  sseOnline: boolean | null;
  reconnectAttempt?: number;
  maxReconnectAttempts?: number;
  isLoading?: boolean;
  isOnline?: boolean;
  actionRail?: ReactNode;
};

const AppShell = memo(function AppShell({
  user,
  onLogout,
  pageTitle,
  pageSubtitle,
  pendingCount,
  cycleTheme,
  themeIcon,
  themeLabel,
  sseOnline,
  reconnectAttempt = 0,
  maxReconnectAttempts = 5,
  isLoading = false,
  isOnline = true,
  actionRail = null,
}: AppShellProps) {
  const { nav, navClassMap, goTab, activeTab } = useNavigationContext();
  const demoMode = isDemoMode();
  const isResidentExperience = user.role === 'owner' || user.role === 'tenant';
  const [isCompactLayout, setIsCompactLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MEDIA_QUERIES.lgDown).matches,
  );
  const isChatTab = activeTab === 'chat';
  const hideChatTitleOnCompact = isCompactLayout && isChatTab;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia(MEDIA_QUERIES.lgDown);
    const handleChange = (event: MediaQueryListEvent) => setIsCompactLayout(event.matches);
    setIsCompactLayout(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const noNetwork = !demoMode && isOnline === false;
  const noSse = !demoMode && !noNetwork && sseOnline === false;
  const showBanner = noNetwork || noSse;
  const reconnectLabel = reconnectAttempt > 0
    ? `Переподключение (попытка ${reconnectAttempt}/${maxReconnectAttempts})`
    : 'Переподключение...';

  const bannerText = noNetwork
    ? 'Нет подключения к интернету'
    : `Нет соединения с сервером, идет ${reconnectLabel.toLowerCase()}`;
  const bannerIcon = noNetwork ? 'ban' : 'refresh';
  const chatNavItem = nav.find(([key]) => key === 'chat');
  const chatUnread = chatNavItem?.[3] ?? 0;
  const showHeaderChatShortcut = user.role === 'security';

  return (
    <>
      {showBanner && (
        <div
          className="offline-banner is-visible"
          role="status" aria-live="polite"
          aria-atomic="true"
        >
          <AppIcon name={bannerIcon} size={13} />
          {' '}
          <span>{bannerText}</span>
        </div>
      )}

      <header className={`header${isResidentExperience ? ' header--resident' : ''}${showBanner ? ' app-content-offset has-offline-banner' : ''}`}>
        <div className="header-inner">
          <div className="header-brand">
            <img src={LOGO} alt="Резиденции Замоскворечья" className="header-logo" />
            <span className="header-wordmark-mobile">Резиденции</span>
            <div className="header-brand-copy">
              <span className="header-wordmark">Резиденции Замоскворечья</span>
              <div className="header-brand-status">
                {demoMode && !isResidentExperience && (
                  <span className="demo-badge" title="Демо-режим: данные хранятся только локально">DEMO</span>
                )}
                {noSse && (
                  <span className="sse-reconnecting" title="Нет соединения с сервером, идет переподключение..." aria-hidden="true">
                    <AppIcon name="refresh" size={12} />
                    <span>{reconnectLabel}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={`header-actions header-actions-shell${showHeaderChatShortcut ? ' header-actions-shell--security' : ''}`}>
            {showHeaderChatShortcut && (
              <button
                className={`theme-btn header-chat-btn${isChatTab ? ' active' : ''}`}
                onClick={() => goTab('chat')}
                title="Открыть чат"
                aria-label="Открыть чат"
                aria-current={isChatTab ? 'page' : undefined}
              >
                <span><AppIcon name="chat" size={14} /></span>
                {chatUnread > 0 && <span className="header-chat-badge">{chatUnread > 9 ? '9+' : String(chatUnread)}</span>}
              </button>
            )}
            <UserMenu
              user={user}
              pendingCount={pendingCount}
              onLogout={onLogout}
              cycleTheme={cycleTheme}
              themeIcon={themeIcon}
              themeLabel={themeLabel}
            />
          </div>
        </div>
      </header>

      <div className="layout">
        <NavigationShell nav={nav} navClassMap={navClassMap} goTab={goTab} userRole={user.role} />
        <main className="content" id="main-content">
          {!hideChatTitleOnCompact && (
            <div className={`page-top${isChatTab ? ' page-top--chat' : ''}`}>
              <div className="page-top-copy">
                <h1 className="page-title">{pageTitle}</h1>
                {activeTab !== 'chat' && <p className="page-sub">{pageSubtitle}</p>}
                {actionRail}
              </div>
            </div>
          )}
          <ErrorBoundary name="Экран">
            <RoleContentRouter user={user} isLoading={isLoading} />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
});

export default AppShell;
