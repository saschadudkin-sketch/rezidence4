import { useMemo, useEffect, useState } from 'react';
import { getRoleManifest } from '../../domain/roleManifest';
import { buildNavItems, buildNavClassMap } from '../../domain/navigation';
import type { MobileNavItem } from '../../domain/navigationSchema';
import { getRoleNextBestAction, getWorkflowCompletionFeedback } from '../../workflow/roleWorkflow';
import { emitUxMetric, UX_METRICS } from '../../utils/telemetryContract';
import type { AppUser } from '../../store/slices/usersSlice';
import type { WorkflowAction, WorkflowMetrics } from '../../workflow/roleWorkflow';

type DashboardExperienceUser = Pick<AppUser, 'role' | 'apartment'>;
type DashboardExperienceAction = WorkflowAction & { onClick?: () => void };

type DashboardExperienceParams = {
  user: DashboardExperienceUser;
  activeTab: string;
  badges: WorkflowMetrics & { blacklistCount: number };
  isLoading: boolean;
  isConnErr: boolean;
  goTab: (tab: string) => void;
};

const TAB_TITLES: Record<string, string> = {
  passes: 'Пропуска',
  tech: 'Техслужба',
  perms: 'Постоянный доступ',
  templates: 'Шаблоны',
  history: 'История',
  chat: 'Чат',
  visitlog: 'Журнал',
  residents: 'Резиденты',
  blacklist: 'Стоп-лист',
  guardpost: 'Скан-пост',
  stats: 'Аналитика',
  requests: 'Операции',
  users: 'Пользователи',
};

export function useDashboardExperience({
  user,
  activeTab,
  badges,
  isLoading,
  isConnErr,
  goTab,
}: DashboardExperienceParams) {
  const { pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount } = badges;
  const [viewReadyEmitted, setViewReadyEmitted] = useState(false);

  useEffect(() => {
    if (viewReadyEmitted || isLoading || isConnErr) return;
    emitUxMetric(UX_METRICS.VIEW_READY, { role: user.role, tab: activeTab });
    setViewReadyEmitted(true);
  }, [viewReadyEmitted, isLoading, isConnErr, user.role, activeTab]);

  const badgesForNav = useMemo(
    () => ({ pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount }),
    [pendingP, pendingT, unreadMsgs, residentNewStatuses, blacklistCount],
  );
  const navItems = useMemo(() => buildNavItems(user.role, badgesForNav), [user.role, badgesForNav]);
  const navClassMap = useMemo(() => buildNavClassMap(user.role, activeTab, badgesForNav), [user.role, activeTab, badgesForNav]);
  const nav = useMemo<MobileNavItem[]>(
    () => navItems.map(({ tab, icon, label, badge }) => [tab, icon, label, badge] as const),
    [navItems],
  );

  const roleManifest = getRoleManifest(user.role);
  const isResident = user.role === 'owner' || user.role === 'tenant';
  const pageTitle = isResident && activeTab === 'passes'
    ? 'Пропуска для гостей'
    : TAB_TITLES[activeTab] || roleManifest.pageTitle;
  const pageSubtitle = isResident
    ? activeTab === 'passes'
      ? `Апартаменты ${user.apartment}. Гости, курьеры и авто без звонков и ожидания.`
      : 'Апартаменты ' + user.apartment
    : (roleManifest.pageSubtitle || '');

  const nextBestAction = useMemo<DashboardExperienceAction | null>(() => {
    const action = getRoleNextBestAction(user.role, { pendingP, pendingT, unreadMsgs, residentNewStatuses });
    if (!action) return null;
    return {
      ...action,
      cta: action.tab === activeTab ? undefined : action.cta,
      onClick: action.tab === activeTab ? undefined : () => goTab(action.tab),
    };
  }, [user.role, pendingP, pendingT, unreadMsgs, residentNewStatuses, goTab, activeTab]);

  const completionFeedback = useMemo(
    () => getWorkflowCompletionFeedback(user.role, { pendingP, pendingT, unreadMsgs, residentNewStatuses }),
    [user.role, pendingP, pendingT, residentNewStatuses, unreadMsgs],
  );

  return {
    nav,
    navClassMap,
    pageTitle,
    pageSubtitle,
    nextBestAction,
    completionFeedback,
  };
}
