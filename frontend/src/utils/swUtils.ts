let _swReg: ServiceWorkerRegistration | null = null;

export const getSwReg = (): ServiceWorkerRegistration | null => _swReg;

export function shouldRegisterSW(): boolean {
  return import.meta.env.PROD;
}

export function registerSW({ force = false }: { force?: boolean } = {}): void {
  if (!('serviceWorker' in navigator)) return;
  if (!force && !shouldRegisterSW()) return;

  navigator.serviceWorker
    .register('/sw.js', { scope: '/' })
    .then((reg) => { _swReg = reg; })
    .catch((e: unknown) => {
      if (import.meta.env.DEV) {
        console.warn('[SW] registration failed:', e);
      }
    });
}
