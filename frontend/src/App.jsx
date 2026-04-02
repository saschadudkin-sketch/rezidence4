import { memo, useEffect, useRef, useState } from 'react';
import { AppProvider } from './store/AppStore';
import Dashboard from './views/Dashboard';
import Login from './views/Login';
import Toasts, { toast } from './ui/Toasts';
import ErrorBoundary from './ui/ErrorBoundary';
import { useAuth, PHASE } from './hooks/useAuth';
import { LOGO } from './constants/logo';
import { API_CONFIG_ERROR } from './config/apiBaseUrl';

/* A-02: CSS layer architecture — tokens → foundations → components/features */
import './styles/tokens.css';
import './styles/foundations.css';
import './styles/theme.css';

// ─── FIX [U1]: Offline indicator ──────────────────────────────────────────────
// Слушает события online/offline и показывает toast + баннер при потере сети.
// Для охранника это критично — пропуски могут не дойти до сервера.
function useOnlineStatus() {
  const TOAST_THROTTLE_MS = 5000;
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const lastToastAtRef = useRef(0);
  const lastStatusRef = useRef(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const showToastThrottled = (message, level) => {
      const now = Date.now();
      if (now - lastToastAtRef.current < TOAST_THROTTLE_MS) return;
      lastToastAtRef.current = now;
      toast(message, level);
    };

    const goOnline = () => {
      if (lastStatusRef.current === true) return;
      lastStatusRef.current = true;
      setIsOnline(true);
      showToastThrottled('Соединение восстановлено', 'success');
    };
    const goOffline = () => {
      if (lastStatusRef.current === false) return;
      lastStatusRef.current = false;
      setIsOnline(false);
      showToastThrottled('Нет интернета — работаем офлайн', 'warning');
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

const OfflineBanner = memo(function OfflineBanner({ visible }) {
  return (
    <div
      className={`offline-banner${visible ? ' is-visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {visible ? 'Нет подключения к интернету' : null}
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

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <ErrorBoundary name="Критическая ошибка">
      <AppProvider>
        <AppInner />
      </AppProvider>
    </ErrorBoundary>
  );
}
