/**
 * RoleContentRouter.jsx — A-01: Role-based content routing extracted from Dashboard.
 * Handles lazy-loading of role-specific views with Suspense fallback.
 * Previously named RenderContent inside Dashboard.jsx.
 */

import { lazy, Suspense, memo } from 'react';
import { ROLES } from '../../domain/permissions';

const ResidentView  = lazy(() => import('../ResidentView'));
const ConciergeView = lazy(() => import('../SecurityConciergeViews').then(m => ({ default: m.ConciergeView })));
const SecurityView  = lazy(() => import('../SecurityConciergeViews').then(m => ({ default: m.SecurityView })));
const AdminView     = lazy(() => import('../AdminView'));

// UI-07: перенесено из inline style в CSS-класс (.view-loading в theme.css)
const fallback = <div className="view-loading">Загрузка...</div>;

const RoleContentRouter = memo(function RoleContentRouter({
  user, activeTab, setActiveTab, highlightReqId, setHighlightReqId,
}) {
  if (user.role === ROLES.SECURITY) {
    return (
      <Suspense fallback={fallback}>
        <SecurityView
          user={user} activeTab={activeTab} setActiveTab={setActiveTab}
          highlightReqId={highlightReqId} setHighlightReqId={setHighlightReqId}
        />
      </Suspense>
    );
  }
  if (user.role === ROLES.CONCIERGE) {
    return (
      <Suspense fallback={fallback}>
        <ConciergeView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
      </Suspense>
    );
  }
  if (user.role === ROLES.ADMIN) {
    return (
      <Suspense fallback={fallback}>
        <AdminView user={user} activeTab={activeTab} />
      </Suspense>
    );
  }
  // FA-06: OWNER, TENANT, CONTRACTOR — все явно получают ResidentView.
  // Новые роли не попадут сюда молча — нужно добавить явный if-блок выше.
  return (
    <Suspense fallback={fallback}>
      <ResidentView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
    </Suspense>
  );
});

export default RoleContentRouter;
