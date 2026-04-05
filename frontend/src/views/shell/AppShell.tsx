/**
 * AppShell.jsx — A-01: App layout shell extracted from Dashboard.
 * Manages the outer structure: header + layout + nav.
 * Dashboard becomes a thin coordinator using AppShell.
 */

import { memo } from 'react';
import { AppIcon } from '../../ui/AppIcon';
import { LOGO } from '../../constants/logo';
import { isDemoMode } from '../../config/runtimeMode';
import ErrorBoundary from '../../ui/ErrorBoundary';
import UserMenu from './UserMenu';
import NavigationShell from './NavigationShell';
import RoleContentRouter from './RoleContentRouter';
import { useNavigationContext } from './NavigationContext';

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
}) {
  const { nav, navClassMap, goTab, activeTab, setActiveTab } = useNavigationContext();

  // FIX [КРИТ-P1]: single unified offline banner — no more double-stacking.
  // Priority: network loss > SSE loss. Only one banner is ever visible at once.
  const noNetwork = isOnline === false;
  const noSse     = !noNetwork && sseOnline === false;
  const showBanner = noNetwork || noSse;

  const bannerText = noNetwork
    ? 'Нет подключения к интернету'
    : 'Нет соединения с сервером — переподключение…';
  const bannerIcon = noNetwork ? 'ban' : 'refresh';

  return (
    <>
      {/* UI-04/UI-05: unified offline banner for both network loss and SSE disconnection.
          Always rendered so CSS transition can animate it in/out smoothly.
          Only one state is shown at a time (network loss takes priority over SSE). */}
      <div
        className={`offline-banner${showBanner ? ' is-visible' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <AppIcon name={bannerIcon} size={13} />
        {' '}<span className={showBanner ? undefined : 'u-sr-only'}>{bannerText}</span>
      </div>

      <header className={`header${showBanner ? ' app-content-offset has-offline-banner' : ''}`}>
        <div className="header-inner">
          <div className="header-brand">
            <img src={LOGO} alt="Резиденции Замоскворечья" className="header-logo" />
            <span className="header-wordmark">Резиденции Замоскворечья</span>
            {isDemoMode() && (
              <span className="demo-badge" title="Демо-режим: данные хранятся только локально">DEMO</span>
            )}
            {noSse && (
              <span className="sse-reconnecting" title="Нет соединения с сервером, переподключение…" aria-hidden="true">
                {/* UI: 'refresh' семантически верен для reconnect; 'history' — это журнал событий */}
                <AppIcon name="refresh" size={12} />
                <span>Переподключение…</span>
              </span>
            )}
          </div>
          <div className="header-actions">
            <button className="theme-btn" onClick={cycleTheme} title="Переключить тему" aria-label={'Тема: ' + themeLabel}>
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
          <div className="page-top">
            <div>
              <h1 className="page-title">{pageTitle}</h1>
              {/* FIX [D-2]: conditional render instead of hidden class — removes element
                  from DOM and avoids screen readers announcing invisible text */}
              {activeTab !== 'chat' && <p className="page-sub">{pageSubtitle}</p>}
            </div>
          </div>
          <ErrorBoundary name="Экран">
            {/* P-02: isLoading passed so RoleContentRouter can show skeleton
                cards while SSE data loads — header + nav remain fully usable */}
            <RoleContentRouter user={user} isLoading={isLoading} />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
});

export default AppShell;
