let _swReg = null;

export const getSwReg = () => _swReg;

export function shouldRegisterSW() {
  return import.meta.env.PROD;
}

export function registerSW({ force = false } = {}) {
  if (!('serviceWorker' in navigator)) return;
  if (!force && !shouldRegisterSW()) return;

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => { _swReg = reg; })
    .catch((e) => console.warn('[SW] registration failed:', e));
}
