/**
 * V1Router — mounts the platform-v1 pages under /v1/*.
 *
 * The component is a single-file routing layer that:
 *   - wraps everything in <V1SessionProvider> so pages/RoleGate can use
 *     `useV1Session()` / `useV1SessionState()`;
 *   - provides role-based redirects at the /v1 index (residents → /v1/access,
 *     security → /v1/guard, technician → /v1/technician-workspace,
 *     contractor → /v1/contractor-workspace,
 *     staff/admin → /v1/staff-workspace);
 *   - bridges URL params into page props so the pages themselves stay
 *     router-agnostic (the pages accept `requestId` / `onBack` props rather
 *     than calling `useParams()` internally).
 *
 * Mount pattern (from App.tsx):
 *     <Route path="/v1/*" element={<V1Router />} />
 *
 * Nested <Routes> inside means every path here is RELATIVE — '/access' here
 * maps to absolute '/v1/access' in the URL bar.
 *
 * D-lite §2: this file does NOT import from legacy src/{services,store,
 * components,requests,views}.  Integration points (QueryClientProvider, the
 * BrowserRouter itself) live in App.tsx and are shared with the legacy app.
 */

import { lazy, Suspense, type ReactNode } from 'react';
import {
  Navigate,
  Route,
  Routes,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  V1SessionProvider,
  useV1SessionState,
  isConciergeRole,
  isResidentRole,
  isStaffRole,
  normalizeUserRole,
} from './store';
import { RoleGate } from './components/RoleGate';
import {
  Alert,
  Inline,
  Spinner,
  uiClasses,
} from './components/ui';
import { useAccessEvents } from './hooks/useAccessEvents';
import { redirectUnauthenticatedV1 } from './lib/authRedirect';

const ResidentAccessPage = lazy(() => import('./pages/ResidentAccessPage').then((m) => ({ default: m.ResidentAccessPage })));
const ResidentPackagesPage = lazy(() => import('./pages/ResidentPackagesPage').then((m) => ({ default: m.ResidentPackagesPage })));
const ResidentAnnouncementsFeedPage = lazy(() => import('./pages/ResidentAnnouncementsFeedPage').then((m) => ({ default: m.ResidentAnnouncementsFeedPage })));
const ResidentDocumentsPage = lazy(() => import('./pages/ResidentDocumentsPage').then((m) => ({ default: m.ResidentDocumentsPage })));
const ResidentNotificationsPage = lazy(() => import('./pages/ResidentNotificationsPage').then((m) => ({ default: m.ResidentNotificationsPage })));
const GuardConsolePage = lazy(() => import('./pages/GuardConsolePage').then((m) => ({ default: m.GuardConsolePage })));
const ConciergeRequestDetailPage = lazy(() => import('./pages/ConciergeRequestDetailPage').then((m) => ({ default: m.ConciergeRequestDetailPage })));
const StaffWorkspacePage = lazy(() => import('./pages/StaffWorkspacePage').then((m) => ({ default: m.StaffWorkspacePage })));
const TechnicianWorkspacePage = lazy(() => import('./pages/TechnicianWorkspacePage').then((m) => ({ default: m.TechnicianWorkspacePage })));
const ContractorWorkspacePage = lazy(() => import('./pages/ContractorWorkspacePage').then((m) => ({ default: m.ContractorWorkspacePage })));
const AnnouncementsAdminPage = lazy(() => import('./pages/AnnouncementsAdminPage').then((m) => ({ default: m.AnnouncementsAdminPage })));
const PackagesAdminPage = lazy(() => import('./pages/PackagesAdminPage').then((m) => ({ default: m.PackagesAdminPage })));
const DocumentsAdminPage = lazy(() => import('./pages/DocumentsAdminPage').then((m) => ({ default: m.DocumentsAdminPage })));
const OnboardingAdminPage = lazy(() => import('./pages/OnboardingAdminPage').then((m) => ({ default: m.OnboardingAdminPage })));
const AccessAdminPage = lazy(() => import('./pages/AccessAdminPage').then((m) => ({ default: m.AccessAdminPage })));
const GisOssReadinessPage = lazy(() => import('./pages/GisOssReadinessPage').then((m) => ({ default: m.GisOssReadinessPage })));
const SkudProviderFailuresPage = lazy(() => import('./pages/SkudProviderFailuresPage').then((m) => ({ default: m.SkudProviderFailuresPage })));
const SensitiveActionsReviewPage = lazy(() => import('./pages/SensitiveActionsReviewPage').then((m) => ({ default: m.SensitiveActionsReviewPage })));
const ResidentOffboardingReportPage = lazy(() => import('./pages/ResidentOffboardingReportPage').then((m) => ({ default: m.ResidentOffboardingReportPage })));
const EmergencyDispatchPage = lazy(() => import('./pages/EmergencyDispatchPage').then((m) => ({ default: m.EmergencyDispatchPage })));
const OperationsDashboardPage = lazy(() => import('./pages/OperationsDashboardPage').then((m) => ({ default: m.OperationsDashboardPage })));
const ManagementCompanyPortfolioPage = lazy(() => import('./pages/ManagementCompanyPortfolioPage').then((m) => ({ default: m.ManagementCompanyPortfolioPage })));
const NotificationOperationsPage = lazy(() => import('./pages/NotificationOperationsPage').then((m) => ({ default: m.NotificationOperationsPage })));
const PropertyDirectoryAdminPage = lazy(() => import('./pages/PropertyDirectoryAdminPage').then((m) => ({ default: m.PropertyDirectoryAdminPage })));
const PrivacyCompliancePage = lazy(() => import('./pages/PrivacyCompliancePage').then((m) => ({ default: m.PrivacyCompliancePage })));

// Role sets mirror the final role model in store/session.tsx. Legacy aliases
// stay listed where current sessions can still emit them.
const RESIDENT_ALLOW = ['resident', 'owner', 'tenant'] as const;
const GUARD_ALLOW = ['security', 'admin', 'property_admin', 'management_company_admin', 'platform_admin'] as const;
const ADMIN_ALLOW = ['admin', 'property_admin', 'management_company_admin', 'platform_admin'] as const;
const PORTFOLIO_ALLOW = ['management_company_admin', 'platform_admin'] as const;
// concierge-detail is gated to staff because the approvals UI is a staff-only
// view of the lifecycle; residents have their own (read-only) request cards.
const CONCIERGE_ALLOW = ['concierge', 'admin', 'property_admin', 'management_company_admin', 'platform_admin'] as const;
const PACKAGES_WORKSPACE_ALLOW = [
  'security',
  'concierge',
  'admin',
  'property_admin',
  'management_company_admin',
  'platform_admin',
] as const;
const STAFF_WORKSPACE_ALLOW = [
  'concierge',
  'security',
  'staff',
  'admin',
  'property_admin',
  'management_company_admin',
  'platform_admin',
] as const;
const TECHNICIAN_WORKSPACE_ALLOW = [
  'technician',
  'admin',
  'property_admin',
  'management_company_admin',
  'platform_admin',
] as const;
const CONTRACTOR_WORKSPACE_ALLOW = [
  'contractor',
  'admin',
  'property_admin',
  'management_company_admin',
  'platform_admin',
] as const;

export function V1Router() {
  return (
    <V1SessionProvider>
      <AccessEventBridge />
      <Suspense fallback={<V1LoadingShell>Загрузка раздела…</V1LoadingShell>}>
        <Routes>
          <Route index element={<V1IndexRedirect />} />
          <Route
            path="access"
            element={
              <RoleGate allow={RESIDENT_ALLOW}>
                <ResidentAccessPage />
              </RoleGate>
            }
          />
        {/* Resident-facing views.  `/v1/my/*` namespace keeps them clearly
            separate from admin/staff endpoints that live at the root
            (`/v1/packages` is staff admin, `/v1/my/packages` is the
            resident's own list).  All gated by RESIDENT_ALLOW. */}
        <Route
          path="my/packages"
          element={
            <RoleGate allow={RESIDENT_ALLOW}>
              <ResidentPackagesPage />
            </RoleGate>
          }
        />
        <Route
          path="my/announcements"
          element={
            <RoleGate allow={RESIDENT_ALLOW}>
              <ResidentAnnouncementsFeedPage />
            </RoleGate>
          }
        />
        <Route
          path="my/documents"
          element={
            <RoleGate allow={RESIDENT_ALLOW}>
              <ResidentDocumentsPage />
            </RoleGate>
          }
        />
        <Route
          path="my/notifications"
          element={
            <RoleGate allow={RESIDENT_ALLOW}>
              <ResidentNotificationsPage />
            </RoleGate>
          }
        />
        <Route
          path="guard"
          element={
            <RoleGate allow={GUARD_ALLOW}>
              <GuardConsolePage />
            </RoleGate>
          }
        />
        <Route
          path="onboarding"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <OnboardingAdminPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/operations"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <OperationsDashboardPage />
            </RoleGate>
          }
        />
        <Route
          path="portfolio"
          element={
            <RoleGate allow={PORTFOLIO_ALLOW}>
              <ManagementCompanyPortfolioPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/access"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <AccessAdminPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/gis-oss"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <GisOssReadinessPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/skud-provider-failures"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <SkudProviderFailuresPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/sensitive-actions"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <SensitiveActionsReviewPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/offboarding"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <ResidentOffboardingReportPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/emergency-dispatch"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <EmergencyDispatchPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/notifications"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <NotificationOperationsPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/directory"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <PropertyDirectoryAdminPage />
            </RoleGate>
          }
        />
        <Route
          path="admin/privacy"
          element={
            <RoleGate allow={ADMIN_ALLOW}>
              <PrivacyCompliancePage />
            </RoleGate>
          }
        />
        <Route
          path="requests/:id"
          element={
            <RoleGate allow={CONCIERGE_ALLOW}>
              <ConciergeRequestDetailRoute />
            </RoleGate>
          }
        />
        <Route
          path="staff-workspace"
          element={
            <RoleGate allow={STAFF_WORKSPACE_ALLOW}>
              <StaffWorkspacePage />
            </RoleGate>
          }
        />
        <Route
          path="technician-workspace"
          element={
            <RoleGate allow={TECHNICIAN_WORKSPACE_ALLOW}>
              <TechnicianWorkspacePage />
            </RoleGate>
          }
        />
        <Route
          path="contractor-workspace"
          element={
            <RoleGate allow={CONTRACTOR_WORKSPACE_ALLOW}>
              <ContractorWorkspacePage />
            </RoleGate>
          }
        />
        <Route
          path="announcements"
          element={
            <RoleGate allow={CONCIERGE_ALLOW}>
              <AnnouncementsAdminPage />
            </RoleGate>
          }
        />
        <Route
          path="packages"
          element={
            <RoleGate allow={PACKAGES_WORKSPACE_ALLOW}>
              <PackagesAdminPage />
            </RoleGate>
          }
        />
        <Route
          path="documents"
          element={
            <RoleGate allow={CONCIERGE_ALLOW}>
              <DocumentsAdminPage />
            </RoleGate>
          }
        />
        {/* Catch-all inside /v1 — kick back to the smart redirect so the role
            decides where to land.  Using Navigate to an empty string would
            loop; send to '.' (relative index) via absolute '/v1'. */}
          <Route path="*" element={<Navigate to="/v1" replace />} />
        </Routes>
      </Suspense>
    </V1SessionProvider>
  );
}

function AccessEventBridge() {
  const eventsState = useAccessEvents();
  if (eventsState !== 'degraded' && eventsState !== 'unsupported') return null;
  return (
    <div className={uiClasses.pageShell}>
      <Alert tone="warning">
        Live-обновления доступа временно недоступны. Данные можно обновить вручную.
      </Alert>
    </div>
  );
}

// ─── Smart role-based landing ───────────────────────────────────────────────
//
// Why not a static <Navigate>? Because `/v1` means different things per role:
//   - resident  → their request list is the natural home
//   - security  → duty station
//   - technician → DH-28 execution workspace
//   - contractor → DH-30 external execution portal
//   - staff      → DH-26 operations workspace
//
// We intentionally route 401 through the legacy /dashboard login shell.
// Loading state is rendered in place so the URL does not flicker.
function V1IndexRedirect() {
  const { status, user, error } = useV1SessionState();

  if (status === 'loading') {
    return <V1LoadingShell>Загрузка сессии…</V1LoadingShell>;
  }

  if (status === 'error') {
    if (error?.kind === 'unauthorized') {
      redirectUnauthenticatedV1();
      return null;
    }
    return (
      <V1LoadingShell>
        <Alert tone="error">
          Не удалось загрузить сессию: {error?.message ?? 'неизвестная ошибка'}
        </Alert>
      </V1LoadingShell>
    );
  }

  if (!user) return <Navigate to="/" replace />;

  // Security lands on the duty station. Admin/concierge roles land on the
  // DH-26 operations workspace but can still open /v1/guard directly.
  if (normalizeUserRole(user.role) === 'security') return <Navigate to="/v1/guard" replace />;
  if (normalizeUserRole(user.role) === 'technician') {
    return <Navigate to="/v1/technician-workspace" replace />;
  }
  if (normalizeUserRole(user.role) === 'contractor') {
    return <Navigate to="/v1/contractor-workspace" replace />;
  }
  if (isResidentRole(user.role)) return <Navigate to="/v1/access" replace />;

  if ([
    'management_company_admin',
    'platform_admin',
  ].includes(normalizeUserRole(user.role))) {
    return <Navigate to="/v1/portfolio" replace />;
  }

  if ([
    'property_admin',
  ].includes(normalizeUserRole(user.role))) {
    return <Navigate to="/v1/admin/operations" replace />;
  }

  if (isConciergeRole(user.role) || isStaffRole(user.role)) {
    return <Navigate to="/v1/staff-workspace" replace />;
  }

  // Unknown role — bounce to legacy dashboard.
  return <Navigate to="/" replace />;
}

function V1LoadingShell({ children }: { children: ReactNode }) {
  return (
    <div className={uiClasses.pageShell}>
      <Inline>
        <Spinner />
        <span className={uiClasses.textMuted}>{children}</span>
      </Inline>
    </div>
  );
}

// ─── Concierge detail URL bridge ────────────────────────────────────────────
//
// The page is router-agnostic — it accepts `requestId` and `onBack` props.
// This tiny wrapper reads the URL param and pipes it through, and wires
// `onBack` to `navigate(-1)` so the back button follows history instead of
// hard-coding a path (users arrive at this URL from different places).
function ConciergeRequestDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  if (!id) return <Navigate to="/v1" replace />;
  return (
    <ConciergeRequestDetailPage
      requestId={id}
      onBack={() => navigate(-1)}
    />
  );
}
