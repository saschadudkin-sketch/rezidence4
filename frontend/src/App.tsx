import { memo, useEffect, lazy, Suspense, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from './store/AppStore';
import { FeatureFlagsProvider } from './contexts/FeatureFlagsContext';
// PF2: Lazy-load Dashboard so login screen ships without the full admin/chat/security chunk.
// The heavy views (AdminView, SecurityConciergeViews, ChatView) are code-split into a
// separate async chunk that only loads after successful authentication.
const Dashboard = lazy(() => import('./views/Dashboard'));
const DesignSystemDemo = lazy(() => import('./views/DesignSystemDemo'));
// Public, unauthenticated guest-pass share page (domhub.su/p/<token>).
// Code-split so residents/admins don't pay for the share-card CSS module.
const GuestPassPage = lazy(() => import('./views/public/GuestPassPage'));
// Authenticated, staff-only guard scanner station (domhub.su/guard/scan).
// Standalone surface — no app shell chrome; the view handles camera +
// server scan + admit/deny.  Code-split because the camera + CSS module
// only loads when a guard navigates to it.
const GuardScannerView = lazy(() => import('./views/guard/GuardScannerView'));
// Phase 4 platform-v1 surface — resident/guard/concierge pages mounted
// under /v1/*.  Own <V1SessionProvider> inside; no overlap with the legacy
// AppStore.  Code-split so legacy entry paths don't pay for the v1 bundle.
const V1Router = lazy(() => import('./v1/V1Router').then((m) => ({ default: m.V1Router })));
import Login from './views/Login';
import Toasts from './ui/Toasts';
import ErrorBoundary from './ui/ErrorBoundary';
import ConsentModal from './components/ConsentModal';
import { useAuth, PHASE } from './hooks/useAuth';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { LOGO } from './constants/logo';
import { API_CONFIG_ERROR } from './config/apiBaseUrl';
import { readStorage, removeStorage, writeStorage, STORAGE_KEYS } from './store/persistence/storageRegistry';
import { DATA_PLANE_POLICY } from './data/dataPlanePolicy';
import { assertEntityPlane } from './data/entityOwnership';
import { logger } from './services/logger';
// A-10: QueryClient — retry/stale policy aligned with apiClient (2 retries, exponential backoff)
//
// T-03: Architecture decision — React Query vs Context API.
//
// DECISION: Context API (AppStore) remains the primary state layer for real-time
// data (requests, users, blacklist, chat). React Query is reserved for:
//   1. One-shot read queries without SSE (e.g. stats, admin reports, garage data)
//   2. Mutations that benefit from optimistic updates + rollback
//
// Rationale: the app uses Server-Sent Events for live sync. React Query's cache
// invalidation model conflicts with SSE push — merging both causes double-fetches.
// The existing Context+useReducer pattern is already optimal for SSE-driven state.
//
// Migration path: new feature endpoints should prefer useQuery/useMutation
// (less boilerplate, automatic loading/error states). Existing SSE-driven slices
// (requestsSlice, chatSlice, usersSlice) should stay as Context reducers.
// One-data-plane policy is codified in data/dataPlanePolicy.ts and should be
// extended there first whenever a new entity is introduced.
//
// FIX [TEST]: QueryClient создаётся внутри App через useState (lazy initializer),
// а не на уровне модуля. Singleton на уровне модуля разделяется между тест-кейсами —
// кеш из одного теста протекает в следующий. useState(() => new QueryClient(...))
// гарантирует изолированный инстанс на каждый рендер приложения.
function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
        staleTime: 60_000,
        gcTime: 5 * 60_000,
      },
    },
  });
}

/* A-02: CSS layer architecture — tokens → foundations → components/features */
import './design-system/tokens.css';
import './design-system/base.css';
import './styles/ds-tokens.css';
import './styles/tokens.css';
import './styles/foundations.css';
import './styles/theme.css';

// ─── Splash ───────────────────────────────────────────────────────────────────

// FIX [MEMO]: LoadingScreen и AppInner без memo пересоздавались при каждом рендере
// AppProvider. LoadingScreen — чисто декоративный, никогда не меняется.
const LoadingScreen = memo(function LoadingScreen() {
  return (
    <div className="loading">
      <img src={LOGO} alt="Резиденции Замоскворечья" className="loading-logo" />
      <div className="loading-name">Резиденции Замоскворечья</div>
      <div className="loading-bar" />
    </div>
  );
});

// ─── AppInner ─────────────────────────────────────────────────────────────────

// FIX [MEMO]: AppInner memo — предотвращает ре-рендер при любом изменении
// AppProvider контекста не связанного с auth (requests, chat обновления).
const AppInner = memo(function AppInner() {
  // FIX [HOOKS]: хуки должны вызываться БЕЗУСЛОВНО — до любого раннего возврата.
  // Нарушение Rules of Hooks: если API_CONFIG_ERROR менялся в runtime,
  // React падал с "Rendered more hooks than during the previous render".
  const { phase, user, login, logout, authNotice } = useAuth();
  const isOnline = useOnlineStatus(); // passed to Dashboard → AppShell for unified banner
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (import.meta.env.DEV) {
      // Single place where developers can inspect the live data-plane map.
      // Helps avoid accidental dual ownership (SSE + Query for same entity).
      logger.debug('[data-plane-policy]', DATA_PLANE_POLICY);
      assertEntityPlane('requests', 'sse');
      assertEntityPlane('chat', 'sse');
      assertEntityPlane('users', 'sse');
      assertEntityPlane('perms', 'sse');
      assertEntityPlane('templates', 'sse');
      assertEntityPlane('blacklist', 'sse');
      assertEntityPlane('visitLogs', 'query');
      assertEntityPlane('stats', 'query');
      assertEntityPlane('garage', 'query');
    }
  }, []);

  useEffect(() => {
    if (phase !== PHASE.DASHBOARD || !user) return;
    const returnTo = readStorage(STORAGE_KEYS.RETURN_TO);
    if (returnTo) removeStorage(STORAGE_KEYS.RETURN_TO);
    const allowedReturnTo = returnTo.startsWith('/dashboard')
      || returnTo.startsWith('/v1/')
      || returnTo === '/v1'
      || returnTo === '/guard/scan';
    if (returnTo && allowedReturnTo && returnTo !== location.pathname + location.search) {
      navigate(returnTo, { replace: true });
    }
  }, [phase, user, navigate, location.pathname, location.search]);

  if (API_CONFIG_ERROR) {
    return (
      <>
        <div className="loading">
          <img src={LOGO} alt="Резиденции Замоскворечья" className="loading-logo" />
          <div className="loading-name">Ошибка конфигурации</div>
          <div className="api-config-error">{API_CONFIG_ERROR}</div>
        </div>
        <Toasts />
      </>
    );
  }

  // Защита: если phase=dashboard но user=null — fallback на логин
  const safePhase = (phase === PHASE.DASHBOARD && !user) ? PHASE.LOGIN : phase;

  return (
    <>
      {safePhase === PHASE.LOADING && <LoadingScreen />}
      {safePhase === PHASE.LOGIN && (
        <ErrorBoundary name="Вход">
          <Login onLogin={login} authNotice={authNotice} />
        </ErrorBoundary>
      )}
      {safePhase === PHASE.DASHBOARD && user && (
        <ErrorBoundary name="Приложение">
          {/* FIX [КРИТ-P1]: isOnline passed down so AppShell shows ONE unified banner.
              OfflineBanner removed from App — AppShell handles both network and SSE loss. */}
          {/* PF2: Suspense fallback shows the existing LoadingScreen while the Dashboard
              chunk downloads. On a warm cache this is instant; on first load it prevents
              a blank flash. */}
          <FeatureFlagsProvider>
            <Suspense fallback={<LoadingScreen />}>
              <Dashboard user={user} onLogout={logout} isOnline={isOnline} />
            </Suspense>
            <ConsentModal enabled={!!user} />
          </FeatureFlagsProvider>
        </ErrorBoundary>
      )}
      <Toasts />
    </>
  );
});

// ─── Guard scanner route guard ────────────────────────────────────────────────
//
// The scanner is authenticated but standalone — it deliberately does NOT
// render the Dashboard shell.  This tiny wrapper reuses `useAuth` so that:
//   — LOADING → splash
//   — LOGIN   → store returnTo and send the user through the normal login
//               flow; on success AppInner picks up returnTo and navigates
//               back here.
//   — DASHBOARD → render the scanner (residents are bounced by the view).
function GuardScannerRoute() {
  const { phase } = useAuth();
  if (phase === PHASE.LOADING) return <LoadingScreen />;
  if (phase !== PHASE.DASHBOARD) {
    // Persist the intended destination so AppInner's existing returnTo
    // mechanism brings the guard back to the scanner after login.
    try { writeStorage(STORAGE_KEYS.RETURN_TO, '/guard/scan'); } catch { /* non-fatal */ }
    return <Navigate to="/dashboard" replace />;
  }
  return (
    <Suspense fallback={<LoadingScreen />}>
      <GuardScannerView />
    </Suspense>
  );
}

// ─── Route tree ───────────────────────────────────────────────────────────────
//
// P-01/A-01: Declarative URL routing with React Router <Routes>/<Route>.
//
// Route structure:
//   /                  → redirect to /dashboard (preserves any ?reqId= params)
//   /dashboard/*       → authenticated app shell (tab rendered by nested Routes)
//   *                  → redirect to / (unknown paths)
//
// The nested /dashboard/:tab matching lives in RoleContentRouter, which
// renders <Routes><Route path=":tab"> so each section has its own URL.
//
function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {/* Public guest-pass share page — no auth, rate-limited backend. Must
          sit above the catch-all redirect so /p/<token> is not rewritten. */}
      <Route path="/p/:token" element={
        <Suspense fallback={<LoadingScreen />}>
          <GuestPassPage />
        </Suspense>
      } />
      <Route path="/dashboard/*" element={<AppInner />} />
      {/* Staff-only guard scanner station.  We reuse the full AppInner auth
          gate by wrapping the scanner in a tiny route guard: if the user is
          authenticated, render the standalone scanner; otherwise fall back
          to the dashboard which owns login + returnTo handling. */}
      <Route path="/guard/scan" element={
        <ErrorBoundary name="Охрана · Сканер">
          <GuardScannerRoute />
        </ErrorBoundary>
      } />
      {/* Platform v1 surface (Phase 4).  V1Router owns its own session
          provider + role gating; auth cookies are shared with the legacy
          app, so a logged-in user here already has a usable session.  If
          unauthenticated, RoleGate stores returnTo and redirects to /dashboard. */}
      <Route path="/v1/*" element={
        <ErrorBoundary name="Платформа v1">
          <Suspense fallback={<LoadingScreen />}>
            <V1Router />
          </Suspense>
        </ErrorBoundary>
      } />
      {/* Design System Demo - Development only */}
      {import.meta.env.DEV && (
        <Route path="/design-system" element={
          <Suspense fallback={<div>Loading...</div>}>
            <DesignSystemDemo />
          </Suspense>
        } />
      )}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const [queryClient] = useState<QueryClient>(createQueryClient);
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary name="Критическая ошибка">
          <AppProvider>
            <AppRoutes />
          </AppProvider>
        </ErrorBoundary>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
