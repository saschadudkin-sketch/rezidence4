import { useState, useEffect, useRef } from 'react';
import { toast } from '../ui/Toasts';

const TOAST_THROTTLE_MS = 5_000;
type OnlineStatusToastLevel = 'success' | 'warning';

/**
 * useOnlineStatus — tracks navigator.onLine with throttled toasts.
 * Shows a success toast when connection is restored, warning when lost.
 * A-07: extracted from App.jsx to its own hook file.
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const lastToastAtRef = useRef<number>(0);
  const lastStatusRef  = useRef<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const showToastThrottled = (message: string, level: OnlineStatusToastLevel): void => {
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
