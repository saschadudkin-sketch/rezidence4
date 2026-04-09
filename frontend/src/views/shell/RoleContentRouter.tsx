/**
 * RoleContentRouter.jsx — P-01/A-01: Declarative tab routing with React Router.
 *
 * Uses <Routes><Route path=":tab"> so each section has a real URL
 * (/dashboard/passes, /dashboard/chat, etc.) instead of a conditional render.
 * The active tab is derived from useParams() — single source of truth is the URL.
 *
 * Role-based access control is still enforced: an unknown or forbidden tab
 * redirects to the role's default first tab.
 */

import { lazy, Suspense, memo } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { ROLES, canAccessTab, getTabsForRole } from '../../domain/permissions';
import { ReqSkeleton } from '../../requests/ReqCard';
import ErrorBoundary from '../../ui/ErrorBoundary';
import ViewStateAdapter from '../../ui/ViewStateAdapter';
import { useNavigationContext } from './NavigationContext';
import type { AppUser } from '../../store/slices/usersSlice';

const ResidentView  = lazy(() => import('../ResidentView'));
const ConciergeView = lazy(() => import('../SecurityConciergeViews').then(m => ({ default: m.ConciergeView })));
const SecurityView  = lazy(() => import('../SecurityConciergeViews').then(m => ({ default: m.SecurityView })));
const AdminView     = lazy(() => import('../AdminView'));

// P-04/U-06: skeleton-плейсхолдер вместо текстового «Загрузка...»
const fallback = <ReqSkeleton count={3} />;

/**
 * TabRoute — inner component that reads :tab from URL params and renders
 * the appropriate role-specific view. Access control is enforced here:
 * forbidden tabs redirect to the role's default first tab.
 */
function TabRoute({ user }: { user: AppUser }) {
  const { tab } = useParams();
  const { highlightReqId, setHighlightReqId, setActiveTab } = useNavigationContext();
  const defaultTab = getTabsForRole(user.role)[0] || 'passes';

  // Guard: unknown or role-forbidden tab → redirect to default
  if (!tab || !canAccessTab(user.role, tab)) {
    return (
      <Navigate
        to={`/dashboard/${defaultTab}`}
        replace
        state={{
          redirectReason: 'forbidden_tab',
          sourceTab: tab || null,
          fallbackTab: defaultTab,
        }}
      />
    );
  }

  if (user.role === ROLES.SECURITY) {
    return (
      <ErrorBoundary name="Пост охраны">
        <Suspense fallback={fallback}>
          <SecurityView
            user={user}
            activeTab={tab}
            setActiveTab={setActiveTab}
            highlightReqId={highlightReqId}
            setHighlightReqId={setHighlightReqId}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }
  if (user.role === ROLES.CONCIERGE) {
    return (
      <ErrorBoundary name="Рабочее место консьержа">
        <Suspense fallback={fallback}>
          <ConciergeView user={user} activeTab={tab} setActiveTab={setActiveTab} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  if (user.role === ROLES.ADMIN) {
    return (
      <ErrorBoundary name="Панель администратора">
        <Suspense fallback={fallback}>
          <AdminView user={user} activeTab={tab} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  // FA-06: OWNER, TENANT, CONTRACTOR — все явно получают ResidentView.
  // FIX [FA-4]: Dev-only exhaustive check — новые роли не упадут молча в ResidentView.
  if (import.meta.env.DEV) {
    const knownResidentRoles = ['owner', 'tenant', 'contractor'];
    if (!knownResidentRoles.includes(user.role)) {
      console.error('[RoleContentRouter] Unknown role, falling back to ResidentView:', user.role);
    }
  }
  return (
    <ErrorBoundary name="Кабинет жильца">
      <Suspense fallback={fallback}>
        <ResidentView user={user} activeTab={tab} setActiveTab={setActiveTab} />
      </Suspense>
    </ErrorBoundary>
  );
}

/**
 * RoleContentRouter — renders nested <Routes> so the current tab is always
 * reflected in the URL path (/dashboard/:tab).
 *
 * Only `user` is needed as a prop — tab and navigation callbacks come from
 * URL params (useParams) and NavigationContext respectively.
 */
const RoleContentRouter = memo(function RoleContentRouter({ user, isLoading = false }: { user: AppUser; isLoading?: boolean }) {
  const defaultTab = getTabsForRole(user.role)[0] || 'passes';

  // P-02: while SSE data is loading, show skeleton cards inside the shell
  // (header + nav remain interactive). This replaces the full-screen spinner.
  if (isLoading) return <ViewStateAdapter entity="requests" state="loading" />;

  return (
    <Routes>
      {/* /dashboard/:tab — main route, access-guarded inside TabRoute */}
      <Route path=":tab" element={<TabRoute user={user} />} />
      {/* /dashboard/ with no tab → redirect to role default */}
      <Route index element={<Navigate to={defaultTab} replace />} />
      {/* catch-all (e.g. /dashboard/unknown/extra) → redirect to role default */}
      <Route path="*" element={<Navigate to={`/dashboard/${defaultTab}`} replace />} />
    </Routes>
  );
});

export default RoleContentRouter;
