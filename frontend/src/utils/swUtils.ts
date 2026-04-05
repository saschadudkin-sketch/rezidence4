/** Модульная переменная — доступна только внутри модулей utils/, не засоряет window */
let _swReg = null;

/** Возвращает текущую SW-регистрацию (или null) */
export const getSwReg = () => _swReg;

/** Регистрирует Service Worker */
export function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => { _swReg = reg; })
    .catch((e) => console.warn('[SW] registration failed:', e));
}
