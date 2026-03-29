# ПОЛНЫЙ АУДИТ: Резиденции Замоскворечья v4 → v5

**Дата**: 2026-03-28  
**Кодовая база**: ~21 000 строк (16 500 frontend + 4 500 backend)  
**Стек**: React 18 + Node.js/Express + PostgreSQL + Redis + nginx + Docker

## Оценка: 7.2 → 8.5 / 10 (после исправлений)

20 файлов изменено + 6 новых = 26 изменений.

---

## КРИТИЧНЫЕ БАГИ (функционал сломан в production) — 6 шт.

### 1. `savePerms` не передаёт `type` → backend 400
**Файл**: `backendProvider.js`  
**Проблема**: Backend `POST /api/perms` требует `{uid, type:'visitors', items:[...]}`. Frontend отправлял `{uid, items:{visitors:[], workers:[]}}` — всегда 400.  
**Решение**: Разбиваем на два параллельных запроса по типам через `Promise.all`.

### 2. `logVisit` / `getVisitLogs` / `clearVisitLogs` — только in-memory
**Файл**: `passesApi.js`  
**Проблема**: `ScanQRModal`, `GuardPostMode`, `VisitLogView` импортируют из `passesApi.js` который хранит данные в RAM. В live mode журнал посещений никогда не попадает на сервер.  
**Решение**: Mode-aware обёртки — live → `visitLogsProvider` (backend API), demo → in-memory.

### 3. `visitLogsProvider.clear()` без `confirm` body → backend 400
**Файл**: `backendProvider.js`, `apiClient.js`  
**Проблема**: Backend `DELETE /api/visit-logs` требует `{confirm:'DELETE_ALL_LOGS'}`. Frontend вызывал без body.  
**Решение**: `apiClient.delete` принимает body, `clear()` отправляет confirm.

### 4. nginx не проксирует `/uploads/` → фото = HTML
**Файл**: `nginx.conf`  
**Проблема**: Загруженные фото (`/uploads/photo_xxx.jpg`) попадают в `try_files → /index.html` — браузер получает HTML вместо JPEG.  
**Решение**: Добавлен `location /uploads/` с `proxy_pass` на backend + CSP `img-src` включает `${BACKEND_URL}`.

### 5. `startSync` не загружает perms/templates/blacklist → пусты после F5
**Файл**: `backendProvider.js`  
**Проблема**: `startSync()` загружал только requests + chat + users. Перм-списки, шаблоны и чёрный список оставались пустыми до ручного перехода на вкладку.  
**Решение**: Параллельная загрузка perms + templates + blacklist при старте. Blacklist загружается с `.catch(() => [])` (может быть 403 для жильцов).

### 6. `useLiveSync` не передавал `setBlacklist` / `setAllMessages`
**Файл**: `useDashboardHooks.js`, `Dashboard.jsx`  
**Проблема**: `setBlacklist` не деструктурировался из `useActions()` и не передавался в `startSync`. `setAllMessages` не передавался как отдельный колбэк.  
**Решение**: Добавлены в callbacksRef и в вызов startSync.

---

## ВАЖНЫЕ ИСПРАВЛЕНИЯ (безопасность / стабильность) — 6 шт.

### 7. `normalizePhone` дублируется с разной логикой
**Файлы**: `constants.js`, `auth.js`, `users.js`  
**Проблема**: `auth.js`: `89xxx` → `+79xxx` (правильно). `users.js`: `89xxx` → `+89xxx` (баг). Пользователь, созданный админом с номером `89...`, не мог войти.  
**Решение**: Единая `normalizePhone()` в `constants.js`, импорт в обоих роутах.

### 8. `resetRefreshState()` никогда не вызывается
**Файл**: `backendProvider.js`  
**Проблема**: `_refreshFailed=true` устанавливается при ошибке refresh, сбрасывается только при успешном API-ответе (невозможен без refresh). Вечный цикл logout.  
**Решение**: `resetRefreshState()` при успешном `verifyOtp`.

### 9. Redis SSE pub/sub подключён + глобальный лимит SSE
**Файлы**: `sse.js`, `sse-redis.js`, `index.js`, `docker-compose.yml`  
**Проблема**: SSE broadcast — in-memory only, горизонтальное масштабирование невозможно. Нет лимита — OOM при 1000+ users.  
**Решение**: `sse.js` экспортирует `setRedisPublish()` + `localBroadcast*()`. `sse-redis.js` подключается при `REDIS_URL`. Redis сервис добавлен в docker-compose. Глобальный лимит 2000 SSE.

### 10. CSRF protection (double-submit cookie)
**Файлы**: `middleware/csrf.js` (НОВЫЙ), `index.js`, `apiClient.js`  
**Проблема**: SameSite=Strict не защищает от subdomain attacks. Safari < 16.4 не полностью поддерживает.  
**Решение**: Сервер выдаёт non-HttpOnly cookie с CSRF-токеном. JS читает cookie, отправляет в `X-CSRF-Token` заголовке. Middleware проверяет cookie === header. Exempt: `/api/client-logs` (sendBeacon не может установить заголовки).

### 11. `PermsList` не синхронизирует с backend
**Файл**: `PermsList.jsx`  
**Проблема**: `save()` вызывал только `localSetPerms()` — dispatch в Redux-подобный стор. При F5 данные загружаются с сервера, где изменений нет.  
**Решение**: Optimistic local update + `services.admin.savePermsEverywhere()`. `permsRef` для стабильных `delVisitor`/`delWorker` callbacks (убрана зависимость от `perms` объекта).

### 12. Docker-compose: Redis сервис
**Файл**: `docker-compose.yml`  
**Добавлено**: `redis:7-alpine` с maxmemory 64MB + LRU eviction, healthcheck, `REDIS_URL` в backend environment.

---

## УЛУЧШЕНИЯ (производительность / DX) — 6 шт.

### 13. visit_logs COUNT(*) → approximate count
**Файл**: `routes/visitLogs.js`  
**Проблема**: `COUNT(*)` без WHERE = seq scan. При 100K+ записей — 200-500ms.  
**Решение**: `pg_class.reltuples` (обновляется VACUUM/ANALYZE, точность ±5%). Fallback на точный COUNT при reltuples=0.

### 14. Frontend error reporter → backend endpoint
**Файлы**: `logger.js`, `routes/clientLogs.js` (НОВЫЙ), `index.js`  
**Проблема**: `_sendToService()` = заглушка. Ошибки production невидимы.  
**Решение**: Буферизация ошибок, батч-отправка через `POST /api/v1/client-logs`, `navigator.sendBeacon` при unload. Дедупликация по message. Rate limit на backend.

### 15. Production-ready nginx.prod.conf
**Файл**: `nginx.prod.conf` (НОВЫЙ)  
**Содержит**: HTTP→HTTPS redirect, TLS 1.2/1.3, HSTS preload, OCSP stapling, Let's Encrypt webroot, все security headers. Готов к использованию после `sed s/YOUR_DOMAIN/...`.

### 16. Тесты normalizePhone
**Файл**: `constants.test.js`  
**Добавлено**: 7 тестов edge cases — 10-digit, 11-digit с 7/8, с разделителями, уже нормализованный, международный.

### 17. Тесты CSRF middleware
**Файл**: `csrf.test.js` (НОВЫЙ)  
**Покрывает**: cookie set, skip GET, skip exempt paths, reject без токена, reject mismatch, allow matching tokens.

### 18. Integration test visit log flow
**Файл**: `visitLogFlow.test.js` (НОВЫЙ)  
**Покрывает**: demo mode in-memory storage, createPassesApiState isolation, clearVisitLogs.

---

## ПОЛНЫЙ СПИСОК ФАЙЛОВ

### Изменённые (20)
```
backend/src/constants.js          — normalizePhone
backend/src/index.js              — CSRF, Redis boot, clientLogs route
backend/src/routes/auth.js        — import normalizePhone
backend/src/routes/users.js       — import normalizePhone
backend/src/routes/visitLogs.js   — approximate COUNT
backend/src/sse.js                — Redis pub/sub hooks, global limit
backend/src/sse-redis.js          — use local broadcast functions
backend/.env.example              — REDIS_URL
docker-compose.yml                — Redis service

frontend/nginx.conf               — /uploads proxy, CSP img-src
frontend/src/views/Dashboard.jsx  — setBlacklist
frontend/src/views/VisitLogView.jsx — canClearLogs, canExport
frontend/src/hooks/useDashboardHooks.js — setBlacklist, setAllMessages
frontend/src/perms/PermsList.jsx  — backend sync, permsRef
frontend/src/services/logger.js   — real _sendToService
frontend/src/services/providers/apiClient.js — CSRF, delete body
frontend/src/services/providers/backendProvider.js — savePerms, startSync, resetRefresh
frontend/src/services/providers/backendProvider.test.js — savePerms test
frontend/src/shared/api/passesApi.js — mode-aware logVisit/getVisitLogs
```

### Новые (6)
```
AUDIT_REPORT.md
backend/src/middleware/csrf.js
backend/src/routes/clientLogs.js
backend/src/__tests__/csrf.test.js
frontend/nginx.prod.conf
frontend/src/integration/visitLogFlow.test.js
```
