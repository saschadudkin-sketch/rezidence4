/**
 * V1Router — mounts the platform-v1 pages under /v1/*.
 *
 * The component is a single-file routing layer that:
 *   - wraps everything in <V1SessionProvider> so pages/RoleGate can use
 *     `useV1Session()` / `useV1SessionState()`;
 *   - provides role-based redirects at the /v1 index (residents → /v1/access,
 *     guards → /v1/guard, concierge-only → /v1/requests, admins see the full
 *     landing with cross-links);
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

import type { ReactNode } from 'react';
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
  isGuardRole,
  isResidentRole,
  isStaffRole,
} from './store';
import { RoleGate } from './components/RoleGate';
import { ResidentAccessPage } from './pages/ResidentAccessPage';
import { GuardConsolePage } from './pages/GuardConsolePage';
import { ConciergeRequestDetailPage } from './pages/ConciergeRequestDetailPage';
import {
  Alert,
  Button,
  Card,
  Inline,
  Spinner,
  Stack,
  uiClasses,
} from './components/ui';

// Role sets — mirror the predicates in store/session.tsx.  We list roles
// explicitly here so the RoleGate's `allow` prop is typed statically and
// obvious at the call site.
const RESIDENT_ALLOW = ['owner', 'tenant', 'contractor'] as const;
const GUARD_ALLOW = ['security', 'admin'] as const;
// concierge-detail is gated to staff because the approvals UI is a staff-only
// view of the lifecycle; residents have their own (read-only) request cards.
const CONCIERGE_ALLOW = ['concierge', 'admin', 'staff'] as const;

export function V1Router() {
  return (
    <V1SessionProvider>
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
        <Route
          path="guard"
          element={
            <RoleGate allow={GUARD_ALLOW}>
              <GuardConsolePage />
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
        {/* Catch-all inside /v1 — kick back to the smart redirect so the role
            decides where to land.  Using Navigate to an empty string would
            loop; send to '.' (relative index) via absolute '/v1'. */}
        <Route path="*" element={<Navigate to="/v1" replace />} />
      </Routes>
    </V1SessionProvider>
  );
}

// ─── Smart role-based landing ───────────────────────────────────────────────
//
// Why not a static <Navigate>? Because `/v1` means different things per role:
//   - resident  → their request list is the natural home
//   - guard     → duty station
//   - concierge → no list page (yet); show a small landing card with a link
//     to paste a request id / go back to the legacy dashboard
//
// We intentionally do NOT redirect to /login here — RoleGate handles 401 via
// window.location.  Loading state is rendered in place so the URL does not
// flicker.
function V1IndexRedirect() {
  const { status, user, error } = useV1SessionState();

  if (status === 'loading') {
    return <V1LoadingShell>Загрузка сессии…</V1LoadingShell>;
  }

  if (status === 'error') {
    if (error?.kind === 'unauthorized') {
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
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

  // Guard priority is highest: an admin who is also on duty as guard still
  // wants the scan console as their home.  Residents get their own list.
  if (isGuardRole(user.role)) return <Navigate to="/v1/guard" replace />;
  if (isResidentRole(user.role)) return <Navigate to="/v1/access" replace />;

  // Concierge / staff: no list page yet.  Show a small landing that explains
  // how to reach a request (they typically arrive via a link from the legacy
  // dashboard or from the request list that still lives there).
  if (isConciergeRole(user.role) || isStaffRole(user.role)) {
    return <ConciergeLanding />;
  }

  // Unknown role — bounce to legacy dashboard.
  return <Navigate to="/" replace />;
}

function ConciergeLanding() {
  const navigate = useNavigate();
  return (
    <div className={uiClasses.pageShell}>
      <header className={uiClasses.pageHeader}>
        <h1 className={uiClasses.pageTitle}>Платформа доступа</h1>
        <p className={uiClasses.pageSubtitle}>
          Откройте заявку из списка в основной консоли или перейдите на пост охраны.
        </p>
      </header>
      <Stack>
        <Card title="Куда перейти?">
          <Inline>
            <Button variant="secondary" onClick={() => navigate('/v1/guard')}>
              Пост охраны
            </Button>
            <Button variant="ghost" onClick={() => navigate('/')}>
              Главная консоль
            </Button>
          </Inline>
        </Card>
      </Stack>
    </div>
  );
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
