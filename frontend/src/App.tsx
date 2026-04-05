import { memo, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// TODO [ВАЖНО-PERF3]: Add ReactQueryDevtools in dev mode once @tanstack/react-query-devtools is installed.
// import { lazy, Suspense } from 'react';
// const ReactQueryDevtools = import.meta.env.DEV
//   ? lazy(() => import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools })))
//   : null;
// Then inside QueryClientProvider: {import.meta.env.DEV && ReactQueryDevtools && (
//   <Suspense fallback={null}><ReactQueryDevtools initialIsOpen={false} /></Suspense>
// )}
import { AppProvider } from './store/AppStore';
import Dashboard from './views/Dashboard';
import Login from './views/Login';
import Toasts from './ui/Toasts';
import ErrorBoundary from './ui/ErrorBoundary';
import { useAuth, PHASE } from './hooks/useAuth';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { LOGO } from './constants/logo';
import { API_CONFIG_ERROR } from './config/apiBaseUrl';
import { readStorage, removeStorage, STORAGE_KEYS } from './store/persistence/storageRegistry';
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
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
      staleTime: 60_000,
      gcTime: 5 * 60_000,
    },
  },
});

/* A-02: CSS layer architecture — tokens → foundations → components/features */
import './styles/tokens.css';
import './styles/foundations.css';
import './styles/theme.css';

// ─── Splash ───────────────────────────────────────────────────────────────────

// FIX [MEMO]: LoadingScreen и AppInner без memo пересоздавались при каждом рендере
// AppProvider. LoadingScreen — чисто декоративный, никогда не меняется.
const LoadingScreen = memo(function LoadingScreen() {
  return (
    <div className="loading">
      <img src={LOGO} alt="" className="loading-logo" />
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
    if (phase !== PHASE.DASHBOARD || !user) return;
    const returnTo = readStorage(STORAGE_KEYS.RETURN_TO);
    if (returnTo) removeStorage(STORAGE_KEYS.RETURN_TO);
    if (returnTo && returnTo.startsWith('/dashboard') && returnTo !== location.pathname + location.search) {
      navigate(returnTo, { replace: true });
    }
  }, [phase, user, navigate, location.pathname, location.search]);

  if (API_CONFIG_ERROR) {
    return (
      <>
        <div className="loading">
          <img src={LOGO} alt="" className="loading-logo" />
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
          <Dashboard user={user} onLogout={logout} isOnline={isOnline} />
        </ErrorBoundary>
      )}
      <Toasts />
    </>
  );
});

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
      <Route path="/dashboard/*" element={<AppInner />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
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
