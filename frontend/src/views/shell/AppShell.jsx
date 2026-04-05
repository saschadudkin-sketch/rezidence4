/**
 * AppShell.jsx — A-01: App layout shell extracted from Dashboard.
 * Manages the outer structure: header + layout + nav.
 * Dashboard becomes a thin coordinator using AppShell.
 */

import { memo } from 'react';
import { AppIcon } from '../../ui/AppIcon';
import { LOGO } from '../../constants/logo';
import { isDemoMode } from '../../config/runtimeMode.js';
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
}) {
  const { nav, navClassMap, goTab, activeTab, setActiveTab } = useNavigationContext();

  const isOffline = sseOnline === false;

  return (
    <>
      {/* UI-04: prominent banner-style SSE offline indicator — more visible than the
          small header chip. Slides in from the top so users immediately notice
          the loss of real-time data without having to look at the header. */}
      <div
        className={`offline-banner${isOffline ? ' is-visible' : ''}`}
        role="status"
        aria-live="polite"
        aria-label="Нет соединения с сервером"
      >
        <AppIcon name="refresh" size={13} />
        {' '}Нет соединения с сервером — переподключение…
      </div>

      <header className={`header${isOffline ? ' app-content-offset has-offline-banner' : ''}`}>
        <div className="header-inner">
          <div className="header-brand">
            <img src={LOGO} alt="Резиденции Замоскворечья" className="header-logo" />
            <span className="header-wordmark">Резиденции Замоскворечья</span>
            {isDemoMode() && (
              <span className="demo-badge" title="Демо-режим: данные хранятся только локально">DEMO</span>
            )}
            {isOffline && (
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
              <p className={`page-sub${activeTab === 'chat' ? ' page-sub--hidden' : ''}`}>{pageSubtitle}</p>
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
