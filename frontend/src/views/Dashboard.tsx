/**
 * Dashboard.jsx — composition root (thin).
 *
 * Feature-level controllers:
 *   useRoleGuidance      — onboarding/demo guidance UX
 *   useConnectivityUX    — SSE/connectivity/retry orchestration
 *   useDashboardExperience — nav model, page metadata, telemetry, action rail
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
import AppShell from './shell/AppShell';
import { NavigationContext } from './shell/NavigationContext';
import ViewStateAdapter from '../ui/ViewStateAdapter';
import { SmartActionRail } from '../workflow/SmartActionRail';
import { useRoleGuidance } from './dashboard/useRoleGuidance';
import { useConnectivityUX } from './dashboard/useConnectivityUX';
import { useDashboardExperience } from './dashboard/useDashboardExperience';
import { clearAppStorage, readStorage, STORAGE_KEYS, writeStorage } from '../store/persistence/storageRegistry';
import { toast } from '../ui/Toasts';

function DemoBanner({ onClose }) {
  const [privateSession, setPrivateSession] = useState(() => readStorage(STORAGE_KEYS.DEMO_PRIVATE_SESSION) === '1');

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
      <span className="demo-welcome-icon"><AppIcon name="alert" size={14} /></span>
      <span className="demo-welcome-text">
        <strong>Демо-режим.</strong>{' '}
        Попробуйте создать пропуск или вызов техслужбы — всё работает без сервера.
        Данные сохраняются только в браузере. На общих устройствах не используйте реальные персональные данные.
      </span>
      <label className="demo-private-toggle">
        <input type="checkbox" checked={privateSession} onChange={togglePrivateSession} />
        Приватная демо-сессия
      </label>
      <button className="btn-outline" onClick={wipeDemoData}>Очистить демо-данные</button>
      <button className="demo-welcome-close" onClick={onClose} aria-label="Закрыть баннер">
        <AppIcon name="close" size={12} />
      </button>
    </div>
  );
}

const ONBOARDING_HINTS = {
  [ROLES.OWNER]:       'Нажмите «+» чтобы создать пропуск для гостя, курьера или подрядчика. Пропуска появятся у охраны автоматически.',
  [ROLES.TENANT]:      'Создайте пропуск для гостя или мастера — охрана получит уведомление мгновенно.',
  [ROLES.CONTRACTOR]:  'Здесь ваши рабочие пропуска. Создайте новый, указав марку и номер авто, если планируется въезд.',
  [ROLES.CONCIERGE]:   'Пропуска, ожидающие подтверждения, — в разделе «Заявки». Подтвердите или отклоните каждую.',
  [ROLES.SECURITY]:    'Отсканируйте QR-код гостя или найдите заявку вручную, чтобы зарегистрировать визит.',
  [ROLES.ADMIN]:       'В разделе «Резиденты» управляйте пользователями. Аналитика доступна во вкладке «Аналитика».',
};

function OnboardingHint({ role, onClose }) {
  const hint = ONBOARDING_HINTS[role];
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
      {guidance.showDemoBanner && <DemoBanner onClose={guidance.dismissDemoBanner} />}
      {guidance.showOnboarding && !guidance.showDemoBanner && (
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
        actionRail={<SmartActionRail action={experience.nextBestAction} feedback={experience.completionFeedback} onAction={experience.nextBestAction?.onClick} />}
      />
    </NavigationContext.Provider>
  );
}
