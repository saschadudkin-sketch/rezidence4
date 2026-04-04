/**
 * RoleContentRouter.jsx — A-01: Role-based content routing extracted from Dashboard.
 * Handles lazy-loading of role-specific views with Suspense fallback.
 * Previously named RenderContent inside Dashboard.jsx.
 */

import { lazy, Suspense, memo } from 'react';
import { ROLES } from '../../domain/permissions';
import { ReqSkeleton } from '../../requests/ReqCard';
import ErrorBoundary from '../../ui/ErrorBoundary';
import { useNavigationContext } from './NavigationContext';

const ResidentView  = lazy(() => import('../ResidentView'));
const ConciergeView = lazy(() => import('../SecurityConciergeViews').then(m => ({ default: m.ConciergeView })));
const SecurityView  = lazy(() => import('../SecurityConciergeViews').then(m => ({ default: m.SecurityView })));
const AdminView     = lazy(() => import('../AdminView'));

// P-04/U-06: skeleton-плейсхолдер вместо текстового «Загрузка...»
const fallback = <ReqSkeleton count={3} />;

const RoleContentRouter = memo(function RoleContentRouter({
  user, activeTab, setActiveTab,
}) {
  const { highlightReqId, setHighlightReqId } = useNavigationContext();
  if (user.role === ROLES.SECURITY) {
    return (
      <ErrorBoundary name="Пост охраны">
        <Suspense fallback={fallback}>
          <SecurityView
            user={user} activeTab={activeTab} setActiveTab={setActiveTab}
            highlightReqId={highlightReqId} setHighlightReqId={setHighlightReqId}
          />
        </Suspense>
      </ErrorBoundary>
    );
  }
  if (user.role === ROLES.CONCIERGE) {
    return (
      <ErrorBoundary name="Рабочее место консьержа">
        <Suspense fallback={fallback}>
          <ConciergeView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  if (user.role === ROLES.ADMIN) {
    return (
      <ErrorBoundary name="Панель администратора">
        <Suspense fallback={fallback}>
          <AdminView user={user} activeTab={activeTab} />
        </Suspense>
      </ErrorBoundary>
    );
  }
  // FA-06: OWNER, TENANT, CONTRACTOR — все явно получают ResidentView.
  // FIX [FA-4]: Dev-only exhaustive check — новые роли не упадут молча в ResidentView.
  if (process.env.NODE_ENV !== 'production') {
    const knownResidentRoles = [ROLES.OWNER, ROLES.TENANT, ROLES.CONTRACTOR];
    if (!knownResidentRoles.includes(user.role)) {
      console.error('[RoleContentRouter] Unknown role, falling back to ResidentView:', user.role);
    }
  }
  return (
    <ErrorBoundary name="Кабинет жильца">
      <Suspense fallback={fallback}>
        <ResidentView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
      </Suspense>
    </ErrorBoundary>
  );
});

export default RoleContentRouter;
