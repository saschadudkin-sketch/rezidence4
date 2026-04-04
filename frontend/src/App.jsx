import { memo, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppProvider } from './store/AppStore';
import Dashboard from './views/Dashboard';
import Login from './views/Login';
import Toasts from './ui/Toasts';
import ErrorBoundary from './ui/ErrorBoundary';
import { useAuth, PHASE } from './hooks/useAuth';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import { LOGO } from './constants/logo';
import { API_CONFIG_ERROR } from './config/apiBaseUrl';

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

const OfflineBanner = memo(function OfflineBanner({ visible }) {
  return (
    <div
      className={`offline-banner${visible ? ' is-visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {/* UI-05: always render text so screen readers detect change;
          visually hidden when banner is not shown via CSS transform */}
      <span className={visible ? undefined : 'u-sr-only'}>
        Нет подключения к интернету
      </span>
    </div>
  );
});

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
  const { phase, user, login, logout } = useAuth();
  const isOnline = useOnlineStatus();

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
      {/* FIX [AUDIT-3 #13]: всегда монтируем баннер, управляем через visible-проп.
          CSS transform плавно выдвигает/прячет его без layout shift.
          padding-top с transition компенсирует высоту баннера для контента ниже. */}
      <OfflineBanner visible={!isOnline} />
      {/* FIX [AUDIT-2 #23]: padding-top когда баннер виден, чтобы не перекрывать header */}
      <div className={`app-content-offset${isOnline ? '' : ' has-offline-banner'}`}>
      {safePhase === PHASE.LOADING && <LoadingScreen />}
      {safePhase === PHASE.LOGIN && (
        <ErrorBoundary name="Вход">
          <Login onLogin={login} />
        </ErrorBoundary>
      )}
      {safePhase === PHASE.DASHBOARD && user && (
        <ErrorBoundary name="Приложение">
          <Dashboard user={user} onLogout={logout} />
        </ErrorBoundary>
      )}
      </div>
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
