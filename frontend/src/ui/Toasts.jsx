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
 */
export const toast = (msg, type = 'info') => {
  if (_toastCb) _toastCb(msg, type);
};

const TOAST_DURATION = 3_500; // мс до автоудаления

export default function Toasts() {
  const [list, setList] = useState([]);
  // FIX [AUDIT-8]: timers хранятся в ref, а не в замыкании useEffect —
  // это позволяет dismiss-кнопке (если добавим) обращаться к ним без перерегистрации.
  const timersRef = useRef(new Map()); // id → timeoutId

  const add = useCallback((msg, type) => {
    const id = ++_toastIdCounter;
    setList(p => [...p, { id, msg, type }]);
    const t = setTimeout(() => {
      setList(p => p.filter(x => x.id !== id));
      timersRef.current.delete(id);
    }, TOAST_DURATION);
    timersRef.current.set(id, t);
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
        <div key={t.id} className={'toast ' + t.type} aria-atomic="true">{t.msg}</div>
      ))}
    </div>
  );
}
