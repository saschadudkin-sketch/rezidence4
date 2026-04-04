// Service Worker — Резиденции Замоскворечья
// Workbox injectManifest mode: self.__WB_MANIFEST injected by vite-plugin-pwa at build time.
// Precaches all hashed build assets + /index.html for reliable offline shell.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';

// ── Workbox precache: хешированные ассеты сборки ─────────────────────────────
// self.__WB_MANIFEST заменяется vite-plugin-pwa массивом { url, revision } записей.
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// ── Navigation: Network-first → offline fallback на /index.html ──────────────
registerRoute(
  ({ request }) => request.mode === 'navigate',
  new NetworkFirst({ cacheName: 'pages', networkTimeoutSeconds: 3 }),
);

// ── Статические ассеты без хеша (логотипы, иконки, манифест) ─────────────────
registerRoute(
  ({ url }) => url.pathname.match(/\.(png|svg|ico|webmanifest)$/),
  new StaleWhileRevalidate({ cacheName: 'static-assets' }),
);

// ── Активация: удаляем старые кеши ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: сеть → кеш (стратегия Network-first) ──────────────────────────────
self.addEventListener('fetch', event => {
  // Пропускаем не-GET
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // FIX [AUDIT]: НЕ кешируем API-запросы и фотографии.
  // ПРИЧИНА: охранник при потере сети получал бы устаревший список заявок из кеша.
  // Для охраны актуальность данных критична — неверное решение о пропуске опасно.
  // /api/   — все backend endpoints (данные должны быть свежими)
  // /uploads/ — фото гостей (авторизованный endpoint, не должен кешироваться без токена)
  if (url.includes('/api/') || url.includes('/uploads/')) return;

  // Внешние шрифты/скрипты — не кешируем (CORS ограничения)
  if (url.includes('googleapis.com') || url.includes('gstatic.com')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Кешируем свежий ответ только для same-origin ресурсов
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Push: показываем уведомление ─────────────────────────────────────────────
self.addEventListener('push', event => {
  let data = { title: 'Резиденции', body: 'Новое уведомление', tag: 'default' };
  try { data = { ...data, ...event.data.json() }; } catch(e) {}

  const options = {
    body:    data.body,
    tag:     data.tag,        // одно уведомление на тег (не дублируем)
    renotify: true,
    icon:    '/logo192.png',
    badge:   '/logo192.png',
    vibrate: [200, 100, 200],
    data:    { url: data.url || '/' },
    actions: data.actions || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── Нажатие на уведомление: открываем/фокусируем окно ───────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        // Уже открыто — фокусируем и навигируем на нужный URL (P-07)
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            return client.focus().then(() => {
              if (targetUrl !== '/' && 'navigate' in client) {
                return client.navigate(targetUrl);
              }
            });
          }
        }
        // Нет открытого окна — открываем сразу на нужном URL
        if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
      })
  );
});

// ── Синхронизация в фоне (Background Sync) ───────────────────────────────────
// Используется для надёжной отправки уведомлений при восстановлении сети
self.addEventListener('sync', event => {
  if (event.tag === 'notify-pending') {
    event.waitUntil(
      self.registration.getNotifications({ tag: 'pending-pass' })
        .then(notes => {
          if (notes.length === 0) {
            // Уведомление ещё не показано — показываем
            return self.registration.showNotification('Новые пропуска', {
              body: 'Есть заявки ожидающие рассмотрения',
              tag: 'pending-pass',
              icon: '/logo192.png',
            });
          }
        })
    );
  }
});
