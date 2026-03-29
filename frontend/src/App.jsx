import { memo, useEffect, useState } from 'react';
import { AppProvider } from './store/AppStore';
import Dashboard from './views/Dashboard';
import Login from './views/Login';
import Toasts, { toast } from './ui/Toasts';
import ErrorBoundary from './ui/ErrorBoundary';
import { useAuth, PHASE } from './hooks/useAuth';
import { LOGO } from './constants/logo';

import './styles/theme.css';

// ─── FIX [U1]: Offline indicator ──────────────────────────────────────────────
// Слушает события online/offline и показывает toast + баннер при потере сети.
// Для охранника это критично — пропуски могут не дойти до сервера.
function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      toast('Соединение восстановлено', 'success');
    };
    const goOffline = () => {
      setIsOnline(false);
      toast('Нет интернета — работаем офлайн', 'warning');
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
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'var(--warn, #f59e0b)', color: '#000',
      textAlign: 'center', padding: '6px 12px',
      fontSize: 13, fontWeight: 600,
      // FIX [AUDIT-3 #13]: плавное появление/скрытие — без резкого layout shift.
      transform: visible ? 'translateY(0)' : 'translateY(-100%)',
      transition: 'transform 220ms ease',
      pointerEvents: visible ? 'auto' : 'none',
    }}>
      Нет подключения к интернету
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
  const { phase, user, login, logout } = useAuth();
  const isOnline = useOnlineStatus();

  // Защита: если phase=dashboard но user=null — fallback на логин
  const safePhase = (phase === PHASE.DASHBOARD && !user) ? PHASE.LOGIN : phase;

  return (
    <>
      {/* FIX [AUDIT-3 #13]: всегда монтируем баннер, управляем через visible-проп.
          CSS transform плавно выдвигает/прячет его без layout shift.
          padding-top с transition компенсирует высоту баннера для контента ниже. */}
      <OfflineBanner visible={!isOnline} />
      {/* FIX [AUDIT-2 #23]: padding-top когда баннер виден, чтобы не перекрывать header */}
      <div style={{ paddingTop: isOnline ? 0 : 36, transition: 'padding-top 220ms ease' }}>
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
