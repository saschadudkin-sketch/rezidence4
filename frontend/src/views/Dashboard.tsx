/**
 * Dashboard.jsx - composition root (thin).
 */

import { useState } from 'react';
import {
  useRequests, useChat, useActions, useBlacklist,
} from '../store/AppStore';
import { AppIcon } from '../ui/AppIcon';
import { useScheduledActivation } from '../hooks/useScheduledActivation';
import {
  useTheme,
  useNavBadges,
  usePushNotifications,
  useArrivalNotifier,
  useNavigation,
} from '../hooks/useDashboardHooks';
import { ROLES } from '../domain/permissions';
import { getRoleResponsibilities } from '../domain/roleResponsibilities';
import AppShell from './shell/AppShell';
import { NavigationContext } from './shell/NavigationContext';
import ViewStateAdapter from '../ui/ViewStateAdapter';
import '../styles/components/utilities-polish.css';
import { useRoleGuidance } from './dashboard/useRoleGuidance';
import { useConnectivityUX } from './dashboard/useConnectivityUX';
import { useDashboardExperience } from './dashboard/useDashboardExperience';
import { clearAppStorage, isDemoPrivateSessionEnabled, writeStorage, STORAGE_KEYS } from '../store/persistence/storageRegistry';
import { toast } from '../ui/Toasts';

function DemoBanner({ onClose }) {
  const [privateSession, setPrivateSession] = useState(() => isDemoPrivateSessionEnabled());

  const togglePrivateSession = () => {
    const next = !privateSession;
    setPrivateSession(next);
    writeStorage(STORAGE_KEYS.DEMO_PRIVATE_SESSION, next ? '1' : '0');
  };

  const wipeDemoData = () => {
    clearAppStorage();
    toast('Локальные демо-данные очищены', 'success');
  };

  return (
    <div className="demo-welcome-banner" role="status" aria-live="polite">
      <span className="demo-welcome-icon"><AppIcon name="info" size={14} /></span>
      <span className="demo-welcome-text">
        <span className="demo-welcome-copy demo-welcome-copy-short">
          <strong>Демо-режим.</strong> Локальные данные без сервера; сохранение включается вручную.
        </span>
        <span className="demo-welcome-copy demo-welcome-copy-long">
          <strong>Демо-режим.</strong>{' '}
          Попробуйте создать пропуск или вызов техслужбы - все работает без сервера.
          По умолчанию сессия приватная и не сохраняет данные между перезапусками. Постоянное демо-хранение включается только вручную.
        </span>
      </span>
      <div className="demo-welcome-actions">
        <label className="demo-private-toggle">
          <input type="checkbox" checked={privateSession} onChange={togglePrivateSession} />
          <span className="demo-private-toggle-long">Приватная демо-сессия</span>
          <span className="demo-private-toggle-short">Приватно</span>
        </label>
        <button className="btn-outline demo-welcome-reset" onClick={wipeDemoData}>
          <span className="demo-welcome-reset-long">Очистить демо-данные</span>
          <span className="demo-welcome-reset-short">Очистить</span>
        </button>
      </div>
      <button className="demo-welcome-close" onClick={onClose} aria-label="Закрыть баннер">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

function OnboardingHint({ role, onClose }) {
  const hint = getRoleResponsibilities(role).onboardingHint;
  if (!hint) return null;

  return (
    <div className="onboarding-hint" role="status" aria-live="polite">
      <span className="onboarding-hint-icon"><AppIcon name="info" size={14} /></span>
      <span className="onboarding-hint-text">{hint}</span>
      <button className="onboarding-hint-close" onClick={onClose} aria-label="Закрыть подсказку">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

export default function Dashboard({ user, onLogout, isOnline = true }) {
  const requests = useRequests();
  const blacklist = useBlacklist();
  const { chat, chatLastSeen } = useChat();
  const {
    setAllRequests, setAllMessages, setAllUsers,
    setPerms, setTemplates, setBlacklist,
    markChatSeen, activateScheduled,
    addToBlacklist, removeFromBlacklist,
    updateUser, deleteUser, addUser,
    updateRequest, addRequest, deleteRequest,
  } = useActions();

  const { cycleTheme, themeIcon, themeLabel } = useTheme();
  const badges = useNavBadges(user, requests, chat, chatLastSeen, blacklist);
  const { pendingT, pendingP, unreadMsgs, residentNewStatuses, blacklistCount, onPassesSeen } = badges;

  usePushNotifications(user, { pendingT, pendingP, unreadMsgs });
  useArrivalNotifier(user, requests);
  useScheduledActivation(requests, activateScheduled);

  const { activeTab, setActiveTab, goTab, highlightReqId, setHighlightReqId } =
    useNavigation(user, { markChatSeen, onPassesSeen });

  const connectivity = useConnectivityUX({
    user,
    syncCallbacks: {
      setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
      addToBlacklist, removeFromBlacklist, updateUser, deleteUser, addUser,
      updateRequest, addRequest, deleteRequest,
    },
  });

  const guidance = useRoleGuidance(user);

  const experience = useDashboardExperience({
    user,
    activeTab,
    badges: { pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount },
    isLoading: connectivity.isLoading,
    isConnErr: connectivity.isConnErr,
    goTab,
  });

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
      {false && guidance.showDemoBanner && <DemoBanner onClose={guidance.dismissDemoBanner} />}
      {false && guidance.showOnboarding && (
        <OnboardingHint role={user.role} onClose={guidance.dismissOnboarding} />
      )}
      <AppShell
        user={user}
        onLogout={onLogout}
        pageTitle={experience.pageTitle}
        pageSubtitle={experience.pageSubtitle}
        pendingCount={pendingT + pendingP}
        cycleTheme={cycleTheme}
        themeIcon={themeIcon}
        themeLabel={themeLabel}
        sseOnline={connectivity.sseOnline}
        isLoading={connectivity.isLoading}
        isOnline={isOnline}
        actionRail={actionRail}
      />
    </NavigationContext.Provider>
  );
}
