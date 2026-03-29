# Audit Fixes — Residenze v3

Все изменения внесены в рамках полного аудита проекта.

---

## 🔴 КРИТИЧЕСКИЕ (немедленный риск безопасности)

### FIX-1 · `backend/src/routes/auth.js` — logout allDevices без верификации токена
**Проблема:** `POST /logout` с `allDevices: true` использовал `jwt.decode()` (не проверяет подпись).
Атакующий мог создать JWT с любым `uid` (без секрета) и принудительно разлогинить любого пользователя.

**Исправление:** добавлен `requireAuth` middleware на маршрут `/logout`.
Теперь `uid` берётся из `req.user` — он верифицирован подписью. `jwt.verify()` вместо `jwt.decode()`.

```diff
- router.post('/logout', async (req, res) => {
-   const payload = token ? jwt.decode(token) : null; // ← без проверки подписи
-   if (allDevices && payload?.uid) { DELETE ... WHERE uid = payload.uid }
+ router.post('/logout', requireAuth, async (req, res) => {
+   const uid = req.user.uid; // ← верифицирован requireAuth
+   if (allDevices) { DELETE ... WHERE uid = $1, [uid] }
```

---

## 🟠 ВАЖНЫЕ

### FIX-2 · `backend/src/routes/upload.js` — предсказуемые имена файлов
**Проблема:** `Math.random()` в имени фото. V8 LCG предсказуем при знании `Date.now()` из заголовков.

```diff
- const filename = `photo_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
+ const { randomBytes } = require('crypto');
+ const filename = `photo_${Date.now()}_${randomBytes(12).toString('hex')}.${ext}`;
```

### FIX-3 · `backend/src/middleware/csrf.js` — CSRF exempt через `endsWith`
**Проблема:** `req.path.endsWith('/send-otp')` совпадало бы с гипотетическим `/evil/send-otp`.

```diff
- const CSRF_EXEMPT_SUFFIX = ['/send-otp', '/verify-otp'];
- if (CSRF_EXEMPT_SUFFIX.some(s => req.path.endsWith(s))) return next();
+ const CSRF_EXEMPT_EXACT = new Set(['/auth/send-otp', '/auth/verify-otp', ...]);
+ if (CSRF_EXEMPT_EXACT.has(req.path)) return next();
```

### FIX-4 · `backend/src/routes/perms.js` — утечка данных в GET /perms/:uid
**Проблема:** любой авторизованный пользователь читал список посетителей/работников чужого профиля.

```diff
+ const { uid: callerUid, role } = req.user;
+ if (callerUid !== req.params.uid && !isStaff(role)) {
+   return res.status(403).json({ error: 'Forbidden' });
+ }
```

### FIX-5 · `backend/src/routes/auth.js` — OTP INSERT до отправки SMS
**Проблема:** если `sendSms()` выбрасывал ошибку, OTP уже был в БД.
Слот занят (max 3 активных OTP), повторный запрос через 5с → 429.

```diff
- await db.query(`INSERT INTO otp_codes...`);
- await sendSms(phone, code); // ← упало → OTP есть, SMS нет
+ await sendSms(phone, code);          // ← сначала отправляем
+ await db.query(`INSERT INTO otp_codes...`); // ← только при успехе
```

---

## 🟡 АРХИТЕКТУРА И ПРОИЗВОДИТЕЛЬНОСТЬ

### FIX-6 · `backend/src/lib/redisClient.js` (новый файл) — shared Redis singleton
**Проблема:** `middleware/auth.js` и `middleware/idempotency.js` каждый создавали свой `ioredis` клиент — два TCP-соединения.

**Исправление:** создан `lib/redisClient.js` с lazy singleton `getRedis()`. Все модули используют его.
`sse-redis.js` — pub через singleton, sub — отдельный клиент (обязательно: протокол Redis запрещает команды в режиме subscribe).

### FIX-7 · `backend/src/services/RequestsService.js` — N+1 в list()
**Проблема:** два отдельных SQL запроса (rows + COUNT) — два roundtrip к БД.

```diff
- const { rows } = await db.query(`SELECT ... LIMIT $1 OFFSET $2`, [limit, offset]);
- const { rows: [{ count }] } = await db.query(`SELECT COUNT(*) FROM requests ...`);
+ const { rows } = await db.query(
+   `SELECT ..., COUNT(*) OVER() AS total_count FROM requests ... LIMIT $1 OFFSET $2`,
+   [limit, offset],
+ );
+ const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
```

### FIX-8 · `backend/src/db.js` — версионированные транзакционные миграции
**Проблема:** единая `migrate()` без учёта версий. При сбое на шаге 7/14 — БД в неконсистентном состоянии. Нет истории изменений схемы.

**Исправление:** массив `MIGRATIONS` с именованными шагами. Каждый шаг:
- Выполняется только один раз (записывается в `schema_migrations`)
- Обёрнут в отдельную транзакцию (`BEGIN` / `COMMIT` / `ROLLBACK`)
- При ошибке — откат и `throw` (сервер не стартует с частичной схемой)

### FIX-9 · `docker-compose.yml` — удалён deprecated `version: '3.8'`
Docker Compose v2 определяет синтаксис автоматически без поля `version`.

---

## Frontend

### FIX-10 · `frontend/src/hooks/useCreateRequest.js` — canvas.getContext null
**Проблема:** в Safari при >16 одновременных canvas-контекстов `getContext('2d')` возвращает `null` → `TypeError: Cannot read properties of null (reading 'drawImage')`.

```diff
- canvas.getContext('2d').drawImage(img, ...);
+ const ctx = canvas.getContext('2d');
+ if (!ctx) { resolve(dataUrl); return; } // graceful degradation
+ ctx.drawImage(img, ...);
```

### FIX-11 · `frontend/src/hooks/useCreateRequest.js` — SRP: убраны re-export утилит
**Проблема:** хук реэкспортировал `toLocalDateInputValue`, `parseLocalDateInputValue` из `utils/dateInput` — нарушение SRP, неявная зависимость.

**Исправление:** строка `export { ... } from '../utils/dateInput'` удалена. Импортируйте напрямую из `../utils/dateInput`.

### FIX-12 · `frontend/src/hooks/useDashboardHooks.js` — разбивка монолита 283 строки
**Проблема:** один файл содержал 6 независимых хуков — нарушение SRP, тяжёлый для тестирования.

**Исправление:** каждый хук вынесен в отдельный файл:
- `hooks/useTheme.js`
- `hooks/useNavBadges.js`
- `hooks/useLiveSync.js` ← **добавлен `isLoading` state**
- `hooks/usePushNotifications.js`
- `hooks/useArrivalNotifier.js`
- `hooks/useNavigation.js`

`useDashboardHooks.js` оставлен как barrel-реэкспорт для обратной совместимости.

### FIX-13 · `frontend/src/hooks/useLiveSync.js` + `views/Dashboard.jsx` — loading skeleton
**Проблема:** пока SSE не прислал первый пакет данных (~300-600мс), пользователь видел пустые списки без индикации.

**Исправление:** `useLiveSync` возвращает `{ isLoading }`. Dashboard показывает spinner пока `isLoading === true`.

---

## Новые тесты

| Файл | Что проверяет |
|------|---------------|
| `backend/src/__tests__/fixes.test.js` | FIX-1 (logout auth), FIX-4 (perms access), FIX-2 (crypto filename), FIX-3 (CSRF exact), FIX-5 (OTP order), FIX-7 (window function) |
| `backend/src/__tests__/migrations.test.js` | FIX-8 (versioned migrations: skip, transaction, rollback) |
| `frontend/src/hooks/useCreateRequest.canvasFix.test.js` | FIX-10 (canvas null), FIX-11 (no re-exports) |
| `frontend/src/hooks/splitHooks.test.js` | FIX-12 (barrel exports), FIX-13 (isLoading) |
