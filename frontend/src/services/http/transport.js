export async function fetchWithTimeout(url, options, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
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
