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

const LOADING_STYLE = { textAlign: 'center', padding: 40, color: 'var(--t4)' };
const fallback = <div style={LOADING_STYLE}>Загрузка...</div>;

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
  return (
    <Suspense fallback={fallback}>
      <ResidentView user={user} activeTab={activeTab} setActiveTab={setActiveTab} />
    </Suspense>
  );
});

export default RoleContentRouter;
