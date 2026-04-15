/**
 * Dashboard.jsx - composition root (thin).
 */

import AppShell from './shell/AppShell';
import { NavigationContext } from './shell/NavigationContext';
import ViewStateAdapter from '../ui/ViewStateAdapter';
import '../styles/components/chat.css';
import '../styles/components/admin-stats.css';
import '../styles/components/resident-experience.css';
import '../styles/components/utilities-polish.css';
import '../styles/components/utilities-layout.css';
import { DemoBanner, OnboardingHint } from './dashboard/DashboardGuidance';
import { useDashboardRuntime } from './dashboard/useDashboardRuntime';
import type { AppUser } from '../store/slices/usersSlice';

type DashboardProps = {
  user: AppUser;
  onLogout: () => void;
  isOnline?: boolean;
};

export default function Dashboard({ user, onLogout, isOnline = true }: DashboardProps) {
  const {
    theme,
    navigation,
    connectivity,
    guidance,
    experience,
    pendingCount,
    isResidentExperience,
  } = useDashboardRuntime(user);
  const { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId } = navigation;

  if (connectivity.isConnErr) {
    return (
      <div className="screen-loading">
        <div className="screen-loading-inner">
          <ViewStateAdapter
            entity="requests"
            state="error"
            title={connectivity.requestsErrorCopy.title}
            subtitle={connectivity.requestsErrorCopy.subtitle}
            actionLabel="Попробовать снова"
            onAction={connectivity.handleRetry}
          />
        </div>
      </div>
    );
  }

  const actionRail = null;
  const suppressSecondaryGuidance = !isResidentExperience && guidance.showDemoBanner
    && (user.role === 'admin' || user.role === 'security');

  return (
    <NavigationContext.Provider
      value={{
        nav: experience.nav,
        navClassMap: experience.navClassMap,
        goTab,
        activeTab,
        setActiveTab,
        highlightReqId,
        setHighlightReqId,
      }}
    >
      {guidance.showDemoBanner && !isResidentExperience && <DemoBanner onClose={guidance.dismissDemoBanner} />}
      {guidance.showOnboarding && !isResidentExperience && !suppressSecondaryGuidance && (
        <OnboardingHint role={user.role} onClose={guidance.dismissOnboarding} />
      )}
      <AppShell
        user={user}
        onLogout={onLogout}
        pageTitle={experience.pageTitle}
        pageSubtitle={experience.pageSubtitle}
        pendingCount={pendingCount}
        cycleTheme={theme.cycleTheme}
        themeIcon={theme.themeIcon}
        themeLabel={theme.themeLabel}
        sseOnline={connectivity.sseOnline}
        reconnectAttempt={connectivity.reconnectAttempt}
        maxReconnectAttempts={connectivity.maxReconnectAttempts}
        isLoading={connectivity.isLoading}
        isOnline={isOnline}
        actionRail={actionRail}
      />
    </NavigationContext.Provider>
  );
}
