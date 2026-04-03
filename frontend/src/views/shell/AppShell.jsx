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

const AppShell = memo(function AppShell({
  user,
  onLogout,
  pageTitle,
  pageSubtitle,
  pendingCount,
  nav,
  navClassMap,
  goTab,
  activeTab,
  setActiveTab,
  highlightReqId,
  setHighlightReqId,
  cycleTheme,
  themeIcon,
  themeLabel,
  sseOnline,
}) {
  return (
    <>
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <img src={LOGO} alt="" className="header-logo" />
            <span className="header-wordmark">Резиденции Замоскворечья</span>
            {isDemoMode() && (
              <span className="demo-badge" title="Демо-режим: данные хранятся только локально">DEMO</span>
            )}
            {/* FA-07: индикатор разрыва SSE-соединения — видна только при переподключении */}
            {sseOnline === false && (
              <span className="sse-reconnecting" title="Нет соединения с сервером, переподключение…" aria-live="polite">
                <AppIcon name="history" size={12} />
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
        <NavigationShell nav={nav} navClassMap={navClassMap} goTab={goTab} />
        <main className="content" id="main-content">
          <div className="page-top">
            <div>
              <h1 className="page-title">{pageTitle}</h1>
              {activeTab !== 'chat' && <p className="page-sub">{pageSubtitle}</p>}
            </div>
          </div>
          <ErrorBoundary name="Экран">
            <RoleContentRouter
              user={user}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              highlightReqId={highlightReqId}
              setHighlightReqId={setHighlightReqId}
            />
          </ErrorBoundary>
        </main>
      </div>
    </>
  );
});

export default AppShell;
