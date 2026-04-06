// FIX [DATA-2]: combineSignals — объединяет timeout-сигнал с внешним signal из apiClient.
// Ранее spread { ...options, signal: controller.signal } перезаписывал options.signal,
// поэтому отмена запроса снаружи (unmount компонента) не работала.
function combineSignals(timeoutSignal, externalSignal) {
  if (!externalSignal) return timeoutSignal;
  // If external signal already aborted, abort immediately
  if (externalSignal.aborted) { timeoutSignal.abort?.(); return externalSignal; }
  // Use native AbortSignal.any() if available (Chrome 116+, Firefox 119+, Safari 17.4+)
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([timeoutSignal, externalSignal]);
  }
  // Polyfill: forward abort from external signal to timeout controller
  const controller = new AbortController();
  const forward = () => controller.abort();
  timeoutSignal.addEventListener('abort', forward, { once: true });
  externalSignal.addEventListener('abort', forward, { once: true });
  return controller.signal;
}

export async function fetchWithTimeout(url: string, options: RequestInit & { signal?: AbortSignal } = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const signal = combineSignals(controller.signal, options.signal);
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Сервер не отвечает. Проверьте соединение.');
    }
    throw new Error('Нет соединения с сервером. Проверьте интернет.');
  } finally {
    clearTimeout(timer);
  }
}

export async function parseApiResponse(res) {
  if (res.status === 204) return null;

  const contentType = (
    typeof res.headers?.get === 'function'
      ? (res.headers.get('content-type') || '')
      : 'application/json'
  ).toLowerCase();

  if (contentType.includes('application/json')) {
    return res.json();
  }

  return res.text();
}
