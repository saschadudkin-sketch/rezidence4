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
import '../styles/components/chat.css';
import '../styles/components/admin-stats.css';
import '../styles/components/resident-experience.css';
import '../styles/components/utilities-polish.css';
import '../styles/components/utilities-layout.css';
import { useRoleGuidance } from './dashboard/useRoleGuidance';
import { useConnectivityUX } from './dashboard/useConnectivityUX';
import { useDashboardExperience } from './dashboard/useDashboardExperience';
import { clearAppStorage, isDemoPrivateSessionEnabled, writeStorage, STORAGE_KEYS } from '../store/persistence/storageRegistry';
import { toast } from '../ui/Toasts';
import type { AppUser, UserRole } from '../store/slices/usersSlice';

type DashboardProps = {
  user: AppUser;
  onLogout: () => void;
  isOnline?: boolean;
};

type DemoBannerProps = {
  onClose: () => void;
};

type OnboardingHintProps = {
  role: UserRole;
  onClose: () => void;
};

const COMPACT_ONBOARDING_HINTS: Partial<Record<UserRole, string>> = {
  contractor: 'Здесь оформляются рабочие пропуска для бригады и автомобиля.',
  concierge: 'Создавайте пропуска и быстро находите резидентов и гостей.',
  security: 'Проверяйте пропуска, сканируйте QR и отмечайте прибытие.',
  admin: 'Контролируйте резидентов, пропуска и показатели комплекса.',
};

function DemoBanner({ onClose }: DemoBannerProps) {
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
        <span className="demo-welcome-copy demo-welcome-copy-compact">
          <strong>Демо.</strong> Пропуска и служебные действия работают локально.
        </span>
        <span className="demo-welcome-copy demo-welcome-copy-short">
          <strong>Демо.</strong> Все сценарии работают локально, без сервера.
        </span>
        <span className="demo-welcome-copy demo-welcome-copy-long">
          <strong>Демо-режим.</strong>{' '}
          Проверяйте ключевые сценарии локально: пропуска, поиск и служебные действия работают без сервера.
          По умолчанию сессия приватная; постоянное хранение включается только вручную.
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

function OnboardingHint({ role, onClose }: OnboardingHintProps) {
  const hint = getRoleResponsibilities(role).onboardingHint;
  const compactHint = COMPACT_ONBOARDING_HINTS[role] || hint;
  if (!hint) return null;

  return (
    <div className="onboarding-hint" role="status" aria-live="polite">
      <span className="onboarding-hint-icon"><AppIcon name="info" size={14} /></span>
      <span className="onboarding-hint-text">
        <span className="onboarding-hint-copy onboarding-hint-copy-full">{hint}</span>
        <span className="onboarding-hint-copy onboarding-hint-copy-compact">{compactHint}</span>
      </span>
      <button className="onboarding-hint-close" onClick={onClose} aria-label="Закрыть подсказку">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

export default function Dashboard({ user, onLogout, isOnline = true }: DashboardProps) {
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

  const residentDefaultTheme = user.role === ROLES.OWNER || user.role === ROLES.TENANT ? 'light' : 'dark';
  const { cycleTheme, themeIcon, themeLabel } = useTheme(residentDefaultTheme);
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
  const isResidentExperience = user.role === ROLES.OWNER || user.role === ROLES.TENANT;

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
      {guidance.showDemoBanner && !isResidentExperience && <DemoBanner onClose={guidance.dismissDemoBanner} />}
      {guidance.showOnboarding && !isResidentExperience && (
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
