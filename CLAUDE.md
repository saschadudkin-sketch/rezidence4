# CLAUDE.md — DomHub

## Что это за проект

**DomHub** (domhub.app) — платформа управления жилыми комплексами класса «Комфорт».
Создана с нуля как замена/следующая версия проекта rezidence4.

Владелец: Александр. Проект создавался в апреле 2026 года.

---

## Класс объектов и модульный состав

Целевой класс объектов: **Комфорт**

Включённые модули:
- ✅ **Пропуска / доступ** — выдача, отзыв, QR-верификация
- ✅ **Информационный стенд** — объявления, правила, документы (board)
- ✅ **Заявки на обслуживание** — сантехника, электрика, уборка и т.д. (service)
- ✅ **Показания счётчиков** — ХВС, ГВС, электричество (meters)
- ✅ **Голосования** — опросы жильцов с вариантами ответов (voting)
- ✅ **Парковка** — список мест, нарушения (parking)
- ✅ **Чат** — общий чат объекта (chat)
- ✅ **Пользователи** — управление жильцами (users)
- ✅ **Платформа** — управление объектами (platform, суперадмин)

Исключённые модули (обсуждались, убраны):
- ❌ Посуточная аренда
- ❌ Доставка Ozon/Wildberries

---

## Архитектура: Multi-tenant

### Ключевая идея
Каждый жилой объект (ЖК) — **отдельная PostgreSQL база данных**.
Центральная «Registry DB» хранит список объектов и их DSN.

```
Клиент → X-Complex-Slug: zamoskvorechye
         ↓
complexResolver → Registry DB → получает DSN объекта
                ↓
           req.db = pool для этого объекта
                ↓
           Роутер работает как обычно
```

### Registry DB
- Таблица `complexes`: id, slug, name, dsn, status, ...
- Статусы объекта: `active` | `suspended` | `maintenance` | `terminated`
- При `suspended`/`maintenance` → 503
- При `terminated` → 410 (объект отключён навсегда)

### LRU Pool Manager
- Файл: `backend/src/registry/poolManager.js`
- MAX_POOLS = 50 одновременных пулов соединений
- TTL = 5 минут на неактивный пул
- Автоматическое вытеснение LRU при переполнении

### complexResolver Middleware
- Файл: `backend/src/middleware/complexResolver.js`
- Определяет slug из заголовка `X-Complex-Slug` или поддомена
- Кеширует результат из Registry DB на 30 секунд
- Прикрепляет к запросу: `req.db`, `req.complexId`, `req.complexSlug`, `req.complexName`
- Экспортирует `invalidateComplexCache(slug)` для сброса кеша

---

## Архитектура: Backend

### Стек
- Node.js (ES modules, `.js` расширения в импортах)
- Express 5.1.0
- PostgreSQL (pg)
- Redis (ioredis) — кеш, ревокация токенов, rate limiting
- Pino — логирование

### Структура
```
backend/src/
  index.js                  — точка входа, запуск сервера
  config/appConfig.js       — валидация env переменных
  lib/
    logger.js               — Pino логгер
    redisClient.js          — lazy Redis singleton
    sseBroadcast.js         — SSE рассылка событий
  registry/
    registryDb.js           — пул Registry DB
    poolManager.js          — LRU менеджер пулов объектов
  middleware/
    complexResolver.js      — мультитенантный роутинг
    auth.js                 — JWT + Redis ревокация
  app/
    createApp.js            — Express app с middleware
    rateLimiters.js         — rate limiters (global, auth, request)
    registerApiRoutes.js    — регистрация всех роутеров
  modules/
    auth/router.js          — OTP авторизация
    access/router.js        — пропуска, QR верификация
    board/router.js         — информационный стенд
    service/router.js       — заявки на обслуживание
    meters/router.js        — показания счётчиков
    voting/router.js        — голосования
    parking/router.js       — парковка и нарушения
    users/router.js         — управление пользователями
    chat/router.js          — чат объекта
    health/router.js        — healthcheck
    platform/router.js      — платформенный суперадмин
  db/
    migrate.js              — миграции Registry DB и объектных БД
```

### API prefix
Все маршруты: `/api/v1/*`

### Аутентификация
- OTP по SMS/звонку (без паролей)
- JWT в HttpOnly cookie
- Refresh token rotation
- Redis-backed ревокация токенов
- Роли: `owner`, `tenant`, `concierge`, `admin`, `superadmin`

### Rate limiting
- Global: 200 req/min
- Auth endpoints: 10 req/15min
- Create request: 20 req/min

---

## Архитектура: Frontend

### Стек
- React 18 + TypeScript
- Vite 6
- React Query (TanStack Query 5) — серверный стейт
- React Router v7
- CSS Modules
- Vitest — тесты

### Структура
```
frontend/src/
  main.tsx
  App.tsx                   — роутинг по ролям
  types.ts                  — общие TypeScript типы
  services/http.ts          — API клиент (fetch wrapper)
  store/authStore.ts        — auth стор (zustand-like)
  hooks/
    useAuth.ts
    useSSE.ts               — SSE подписки
  views/
    LoginView.tsx           — OTP вход
    resident/
      ResidentView.tsx      — главный layout жильца
      tabs/
        PassesTab.tsx       — пропуска
        BoardTab.tsx        — стенд объявлений
        ServiceTab.tsx      — заявки
        MetersTab.tsx       — счётчики
        VotingTab.tsx       — голосования
        ChatTab.tsx         — чат
        ParkingTab.tsx      — парковка
    admin/AdminView.tsx     — панель администратора
    security/SecurityView.tsx — интерфейс охраны (QR сканер)
    platform/PlatformView.tsx — суперадмин (управление объектами)
```

### Роутинг по ролям
```
/login                → LoginView
/                     → ResidentView (owner, tenant)
/admin                → AdminView (admin, concierge)
/security             → SecurityView (concierge)
/platform             → PlatformView (superadmin)
```

---

## База данных: таблицы объектного БД

Основные таблицы в каждой объектной БД:

| Таблица | Назначение |
|---------|-----------|
| `users` | Жильцы и сотрудники объекта |
| `access_requests` | Заявки на пропуска |
| `access_request_history` | История изменений статусов |
| `token_revocations` | Отозванные JWT |
| `refresh_tokens` | Refresh токены |
| `otp_codes` | OTP коды для входа |
| `board_posts` | Публикации на стенде |
| `service_requests` | Заявки на обслуживание |
| `meter_readings` | Показания счётчиков |
| `polls` | Голосования |
| `votes` | Голоса жильцов |
| `parking_spots` | Парковочные места |
| `parking_violations` | Нарушения парковки |
| `chat_messages` | Сообщения чата |

Миграции: `backend/src/db/migrate.js`

---

## Инфраструктура

### Docker Compose сервисы
- `postgres-registry` — центральная Registry DB (порт 5432)
- `redis` — кеш и очереди (порт 6379)
- `backend` — Node.js API (порт 3000)
- `frontend` — React + Nginx (порт 80)

Объектные БД создаются отдельно вне docker-compose (или через платформенный API).

### Env переменные (см. .env.example)
Обязательные:
- `REGISTRY_DATABASE_URL` — DSN центральной БД
- `JWT_SECRET` — минимум 32 символа
- `FRONTEND_URL` — для CORS

В production дополнительно:
- `UPLOAD_SIGNING_SECRET`

---

## Ключевые архитектурные решения

### 1. Отключение объекта
Меняем `status` в Registry DB → `terminated`.
При следующем запросе complexResolver вернёт 410.
Кеш сбрасывается через `invalidateComplexCache(slug)`.

### 2. Race conditions в пропусках
В `access/router.js` PATCH статуса использует `SELECT FOR UPDATE` в транзакции.
409 Conflict если клиент отправил устаревший `expectedCurrentStatus`.

### 3. SSE для реального времени
Bulk hydrate при загрузке + инкрементальные SSE обновления.
Файл: `backend/src/lib/sseBroadcast.js`

### 4. Показания счётчиков
Защита от регрессии — новые показания не могут быть меньше предыдущих.
Upsert по (uid, period) — можно исправить показания в том же месяце.

### 5. Голосования
ON CONFLICT (poll_id, uid) — жилец может изменить голос.
choices хранятся как JSON массив в колонке polls.choices.

---

## Что ещё не сделано / идеи для развития

- [ ] Push-уведомления (Web Push API)
- [ ] Интеграция с Telegram (bot для уведомлений)
- [ ] Интеграция со СКУД (контроль доступа через физические устройства)
- [ ] Интеграция с 1С (выгрузка данных для бухгалтерии)
- [ ] Webhook платформа (HMAC-SHA256 подписи)
- [ ] Финансовый модуль (платежи, квитанции)
- [ ] Мобильное приложение (React Native)
- [ ] Тесты (unit + e2e)
- [ ] CI/CD pipeline

---

## Паттерны кода

- Роуты тонкие — бизнес-логика в сервисах/хелперах (не в роутерах)
- ES modules везде (`import/export`, `.js` расширения)
- Async/await + try/catch + `next(err)` в Express
- `COALESCE` в UPDATE запросах для partial update
- Параметризованные запросы везде (защита от SQL injection)
- `req.db` — всегда объектная БД текущего запроса

---

## Локальный запуск

```bash
# 1. Зависимости
cd backend && npm install
cd ../frontend && npm install

# 2. Env
cp .env.example .env
# Заполнить REGISTRY_DATABASE_URL, JWT_SECRET, FRONTEND_URL

# 3. Через Docker
docker-compose up -d

# 4. Миграции
cd backend && node src/db/migrate.js

# 5. Dev режим
cd backend && npm run dev
cd frontend && npm run dev
```
