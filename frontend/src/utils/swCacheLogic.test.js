/**
 * utils/swUtils.test.js — тесты на логику Service Worker
 *
 * FIX [AUDIT]: проверяем что SW НЕ кеширует /api/ и /uploads/.
 * Использует jsdom-среду CRA (window/document доступны).
 */

// ─── Хелпер: проверяет, должен ли SW пропустить URL (не кешировать) ───────────
//
// Копируем логику из sw.js — SW не может быть напрямую импортирован в jest,
// поэтому тестируем логику изолированно.

function shouldSkipCaching(url, method = 'GET') {
  if (method !== 'GET') return true;
  if (url.includes('/api/'))         return true;
  if (url.includes('/uploads/'))     return true;
  if (url.includes('googleapis.com')) return true;
  if (url.includes('gstatic.com'))   return true;
  return false;
}

// ─── /api/ endpoints НЕ должны кешироваться ───────────────────────────────────

describe('SW: /api/ не кешируется', () => {
  const apiUrls = [
    'http://localhost/api/requests',
    'http://localhost/api/chat/messages',
    'http://localhost/api/users',
    'http://localhost/api/auth/me',
    'http://localhost/api/v1/requests',
    'http://localhost/api/chat/stream', // SSE
    'http://localhost/api/health',
  ];

  test.each(apiUrls)('пропускает %s (не кеширует)', (url) => {
    expect(shouldSkipCaching(url)).toBe(true);
  });
});

// ─── /uploads/ НЕ должны кешироваться ────────────────────────────────────────

test('SW пропускает /uploads/ — авторизованный endpoint', () => {
  expect(shouldSkipCaching('http://localhost/uploads/photo_123.jpg')).toBe(true);
  expect(shouldSkipCaching('http://localhost/uploads/photo_456.png')).toBe(true);
});

// ─── Статические ресурсы ДОЛЖНЫ кешироваться ────────────────────────────────

describe('SW: статические ресурсы кешируются', () => {
  const staticUrls = [
    'http://localhost/',
    'http://localhost/index.html',
    'http://localhost/manifest.json',
    'http://localhost/static/js/main.chunk.js',
    'http://localhost/logo192.png',
  ];

  test.each(staticUrls)('кеширует %s', (url) => {
    expect(shouldSkipCaching(url)).toBe(false);
  });
});

// ─── Внешние ресурсы пропускаются ────────────────────────────────────────────

test('SW пропускает googleapis.com', () => {
  expect(shouldSkipCaching('https://fonts.googleapis.com/css2?family=Inter')).toBe(true);
});

test('SW пропускает gstatic.com', () => {
  expect(shouldSkipCaching('https://fonts.gstatic.com/s/inter/v13/abc.woff2')).toBe(true);
});

// ─── Не-GET методы пропускаются ──────────────────────────────────────────────

test('SW пропускает POST запросы', () => {
  expect(shouldSkipCaching('http://localhost/static/js/main.js', 'POST')).toBe(true);
});

test('SW пропускает DELETE запросы', () => {
  expect(shouldSkipCaching('http://localhost/static/logo.png', 'DELETE')).toBe(true);
});
