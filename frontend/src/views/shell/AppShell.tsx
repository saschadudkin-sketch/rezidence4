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
  isLoading = false,
  isOnline = true,
  actionRail = null,
}: AppShellProps) {
  const { nav, navClassMap, goTab, activeTab } = useNavigationContext();
  const demoMode = isDemoMode();
  const [isCompactLayout, setIsCompactLayout] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1024px)').matches,
  );
  const isChatTab = activeTab === 'chat';
  const hideChatTitleOnCompact = isCompactLayout && isChatTab;
  const securityChatBadge = nav.find(([key]) => key === 'chat')?.[3] || 0;
  const showSecurityHeaderChat = user.role === 'security';

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const media = window.matchMedia('(max-width: 1024px)');
    const handleChange = (event: MediaQueryListEvent) => setIsCompactLayout(event.matches);
    setIsCompactLayout(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const noNetwork = !demoMode && isOnline === false;
  const noSse = !demoMode && !noNetwork && sseOnline === false;
  const showBanner = noNetwork || noSse;

  const bannerText = noNetwork
    ? 'Нет подключения к интернету'
    : 'Нет соединения с сервером, идет переподключение...';
  const bannerIcon = noNetwork ? 'ban' : 'refresh';

  return (
    <>
      <div
        className={`offline-banner${showBanner ? ' is-visible' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <AppIcon name={bannerIcon} size={13} />
        {' '}
        <span className={showBanner ? undefined : 'u-sr-only'}>{bannerText}</span>
      </div>

      <header className={`header${showBanner ? ' app-content-offset has-offline-banner' : ''}`}>
        <div className="header-inner">
          <div className="header-brand">
            <img src={LOGO} alt="Резиденции Замоскворечья" className="header-logo" />
            <div className="header-brand-copy">
              <span className="header-wordmark">Резиденции Замоскворечья</span>
              <div className="header-brand-status">
                {demoMode && (
                  <span className="demo-badge" title="Демо-режим: данные хранятся только локально">DEMO</span>
                )}
                {noSse && (
                  <span className="sse-reconnecting" title="Нет соединения с сервером, идет переподключение..." aria-hidden="true">
                    <AppIcon name="refresh" size={12} />
                    <span>Переподключение...</span>
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className={`header-actions header-actions-shell${showSecurityHeaderChat ? ' header-actions-shell--security' : ''}`}>
            {showSecurityHeaderChat && (
              <button className={`theme-btn header-chat-btn${isChatTab ? ' active' : ''}`} onClick={() => goTab('chat')} title="Открыть чат" aria-label="Открыть чат">
                <span><AppIcon name="chat" size={14} /></span>
                <span>Чат</span>
                {securityChatBadge > 0 && <span className="header-chat-badge">{securityChatBadge > 9 ? '9+' : String(securityChatBadge)}</span>}
              </button>
            )}
            <button className="theme-btn" onClick={cycleTheme} title="Переключить тему" aria-label={`Тема: ${themeLabel}`}>
              <span><AppIcon name={themeIcon} size={14} /></span>
              <span>{themeLabel}</span>
            </button>
            <UserMenu user={user} pendingCount={pendingCount} onLogout={onLogout} />
          </div>
        </div>
      </header>

      <div className="layout">
        <NavigationShell nav={nav} navClassMap={navClassMap} goTab={goTab} userRole={user.role} />
        <main className="content" id="main-content">
          <div className={`page-top${isChatTab ? ' page-top--chat' : ''}${hideChatTitleOnCompact ? ' page-top--chat-compact' : ''}`}>
            <div className="page-top-copy">
              <h1 className={`page-title${hideChatTitleOnCompact ? ' page-title--chat-compact' : ''}`}>{pageTitle}</h1>
              {activeTab !== 'chat' && <p className="page-sub">{pageSubtitle}</p>}
              {actionRail}
            </div>
          </div>
          <ErrorBoundary name="Экран">
            <RoleContentRouter user={user} isLoading={isLoading} />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
});

export default AppShell;
