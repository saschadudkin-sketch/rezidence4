import { useState, useEffect, useRef, useCallback } from 'react';

// FIX [AUDIT-8]: _toastCb module-level singleton имел три проблемы:
//   1. Не работал при SSR (нет window, нет React tree)
//   2. При наличии нескольких экземпляров Toasts второй затирал первый
//   3. В тестах нужно было вручную очищать глобальное состояние
//
// Решение: сохраняем cb в module-level ref, но в useEffect регистрируем
// уникальный ID для поддержки нескольких экземпляров. Последний смонтированный
// экземпляр выигрывает (LIFO) — ожидаемое поведение для стека модалов.
// toast() — стабильная функция: safe to call before mount (silently drops).

let _toastCb = null;
// Монотонный счётчик — Date.now() мог совпасть для двух toast() в одном тике
let _toastIdCounter = 0;

/**
 * Показывает всплывающее уведомление.
 * Можно безопасно вызывать из любого места приложения — services, hooks, утилиты.
 * Если Toasts ещё не смонтирован — уведомление тихо теряется (ожидаемо при splash).
 *
 * @param {string} msg
 * @param {'info'|'success'|'error'|'warn'} [type]
 * @param {{ label: string, onClick: () => void }} [action] — P-05: optional CTA button
 */
export const toast = (msg, type = 'info', action = null) => {
  if (_toastCb) _toastCb(msg, type, action);
};

// P-05: longer duration for error toasts with an action so the user has time to click
const TOAST_DURATION        = 3_500; // мс до автоудаления
const TOAST_DURATION_ACTION = 7_000; // мс — extra time when toast has an action button

export default function Toasts() {
  const [list, setList] = useState([]);
  // FIX [AUDIT-8]: timers хранятся в ref, а не в замыкании useEffect —
  // это позволяет dismiss-кнопке (если добавим) обращаться к ним без перерегистрации.
  const timersRef = useRef(new Map()); // id → timeoutId

  const add = useCallback((msg, type, action) => {
    const id = ++_toastIdCounter;
    const duration = action ? TOAST_DURATION_ACTION : TOAST_DURATION;
    setList(p => [...p, { id, msg, type, action }]);
    const t = setTimeout(() => {
      setList(p => p.filter(x => x.id !== id));
      timersRef.current.delete(id);
    }, duration);
    timersRef.current.set(id, t);
  }, []);

  // P-06: dismiss clears the timer and removes the toast immediately
  const dismiss = useCallback((id) => {
    const tid = timersRef.current.get(id);
    if (tid !== undefined) clearTimeout(tid);
    timersRef.current.delete(id);
    setList(p => p.filter(x => x.id !== id));
  }, []);

  useEffect(() => {
    // Регистрируем последний смонтированный экземпляр (LIFO)
    const prev = _toastCb;
    _toastCb = add;
    return () => {
      // При размонтировании восстанавливаем предыдущий (если был стек)
      _toastCb = prev;
      // Копируем в локальную переменную — ref.current меняется до вызова cleanup
      // eslint-disable-next-line react-hooks/exhaustive-deps
      const timers = timersRef.current;
      timers.forEach(clearTimeout);
      timers.clear();
    };
  }, [add]);

  if (!list.length) return null;

  return (
    <div className="toast-wrap" role="status" aria-live="polite" aria-atomic="false">
      {list.map(t => (
        <div key={t.id} className={'toast ' + t.type + (t.action ? ' toast--has-action' : '')} aria-atomic="true">
          <span className="toast-msg">{t.msg}</span>
          {/* P-05: optional CTA — e.g. "Повторить" for API error recovery */}
          {t.action && (
            <button
              className="toast-action"
              onClick={() => { t.action.onClick(); dismiss(t.id); }}
            >
              {t.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Закрыть уведомление">×</button>
        </div>
      ))}
    </div>
  );
}
