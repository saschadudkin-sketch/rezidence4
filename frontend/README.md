# Резиденции Замоскворечья

PWA-система управления доступом для жилого комплекса. React 18 + nginx + Docker.  
Два режима: **demo** (без сервера, localStorage) и **live** (Node.js + PostgreSQL backend).

## Требования

- Node.js 20+
- npm 10+

## Локальная разработка

```bash
npm install
npm start
```

Приложение запускается в demo-режиме. Для live-режима создайте `.env.local`:
```env
VITE_RUNTIME_MODE=live
VITE_API_URL=http://localhost:3001
```

## Docker build env convention

Для frontend build/runtime в Docker используется **только** префикс `VITE_*`:

- `VITE_RUNTIME_MODE`
- `VITE_API_URL`

Важно: в `frontend/Dockerfile` **нет** маппинга `REACT_APP_* -> VITE_*`, поэтому в `docker-compose.yml` и CI нужно передавать именно `VITE_*` переменные.


## Тесты

```bash
# Только тесты mode/services (быстро)
npm run test:mode-services

# Тесты + production build
npm run verify:all
```

## Деплой на Timeweb VPS

См. **VPS_DEPLOY.md** — пошаговая инструкция с Docker, HTTPS (Let's Encrypt) и nginx.

Краткий старт:
```bash
cp .env.example .env
# заполните .env: BACKEND_URL=https://api.your-domain.ru
docker compose up -d --build
```

## CI

GitHub Actions (`CI` workflow) запускается на каждый push в `main` и pull request:
- `npm ci`
- `npm run verify:all` (все тесты + production build)

## Архитектура

| Путь | Назначение |
|---|---|
| `src/config/runtimeMode.js` | Определение режима (demo/live) |
| `src/services/providers/` | Провайдеры сервисов: demo и backend |
| `src/domain/` | Бизнес-логика: права, статусы, валидация |
| `src/store/` | Redux-подобный стор (Context + useReducer) |
| `src/hooks/useAuth.js` | Аутентификация, восстановление сессии |
| `src/shared/api/passesApi.js` | API пропусков и журнала посещений |
