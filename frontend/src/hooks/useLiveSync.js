import { useState, useEffect, useRef } from 'react';
import { canManageRequests } from '../constants/requestPredicates.js';
import { ROLES } from '../domain/permissions';
import { sendNotif, playAlert } from '../utils.js';
import { isLiveMode, isDemoMode } from '../config/runtimeMode.js';
import { services } from '../services/providers/serviceContainer';

/**
 * useLiveSync — SSE-синхронизация с сервером.
 *
 * FIX [UX]: добавлен isLoading — пока данные не загружены, Dashboard показывает
 * skeleton вместо пустых списков. Ранее пользователь видел пустой экран 300-600мс.
 *
 * FIX [REACT-2]: стабильный ref для колбэков вместо передачи в deps useEffect.
 * Изменение любого колбэка не перезапускает SSE-соединение.
 */
export function useLiveSync(user, {
  setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist,
  prevPendingP, prevPendingT, prevMsgs,
}) {
  const [isLoading, setIsLoading] = useState(true);

  // Стабильный ref — колбэки обновляются без перезапуска эффекта
  const callbacksRef = useRef({});
  useEffect(() => {
    callbacksRef.current = { setAllRequests, setAllMessages, setAllUsers, setPerms, setTemplates, setBlacklist };
  });

  // FIX: флаг-ref, чтобы setIsLoading(false) вызвался ровно один раз.
  // Без него: setAllRequests-обёртка И onRequests оба вызывали setIsLoading(false)
  // при первом пакете данных → двойной state update (безвредный в React 18, но лишний).
  const loadingClearedRef = useRef(false);
  const clearLoading = () => {
    if (!loadingClearedRef.current) {
      loadingClearedRef.current = true;
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isLiveMode() && !isDemoMode()) {
      setIsLoading(false);
      return;
    }

    // Сброс флага при перезапуске эффекта (смена uid/role)
    loadingClearedRef.current = false;

    let cleanupFn = null;
    let cancelled  = false;

    Promise.resolve(services.liveData.startSync({
      userUid:        user.uid,
      setAllRequests: (...a) => {
        callbacksRef.current.setAllRequests?.(...a);
        clearLoading();
      },
      setAllMessages: (...a) => callbacksRef.current.setAllMessages?.(...a),
      setAllUsers:    (...a) => callbacksRef.current.setAllUsers?.(...a),
      setBlacklist:   (e)    => callbacksRef.current.setBlacklist?.(e),
      onRequests: (docs) => {
        const newP = docs.filter(r => r.type === 'pass' && r.status === 'pending').length;
        if (newP > prevPendingP.current && user.role === ROLES.SECURITY) {
          sendNotif('Новый пропуск', 'Требует рассмотрения', 'pass');
          playAlert('pass');
        }
        prevPendingP.current = newP;

        const newT = docs.filter(r => r.type === 'tech' && r.status === 'pending').length;
        if (newT > prevPendingT.current && canManageRequests(user.role)) {
          sendNotif('Техзаявка', 'Новая заявка в техслужбу', 'tech');
          playAlert('tech');
        }
        prevPendingT.current = newT;
        callbacksRef.current.setAllRequests?.(docs);
        clearLoading();
      },
      onChat: (event) => {
        if (event.type === 'added' && event.message) {
          if (event.message.uid !== user.uid) {
            sendNotif(
              'Сообщение от ' + event.message.name,
              (event.message.text || '').slice(0, 60),
              'chat',
            );
          }
          prevMsgs.current += 1;
        }
      },
      onUsers:     (...a) => callbacksRef.current.setAllUsers?.(...a),
      onPerms:     (p)    => callbacksRef.current.setPerms?.(user.uid, p),
      onTemplates: (t)    => callbacksRef.current.setTemplates?.(user.uid, t),
    }))
    .then(fn => {
      if (cancelled) {
        if (typeof fn === 'function') fn();
        return;
      }
      if (typeof fn === 'function') cleanupFn = fn;
    })
    .catch((err) => {
      console.error('[useLiveSync] startSync failed:', err);
      clearLoading(); // ошибка — тоже снимаем skeleton
    });

    return () => {
      cancelled = true;
      cleanupFn?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role, user.uid]);

  return { isLoading };
}
