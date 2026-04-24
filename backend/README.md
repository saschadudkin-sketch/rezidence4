# Backend maintenance notes

## Logger config contract

`src/logger.js` builds pino config through `src/loggerConfig.js`.

Expected behavior:

- `NODE_ENV=test` → `level: "warn"`, `transport: undefined`
- `NODE_ENV=development` → `level: "info"` (or `LOG_LEVEL` override), `transport.target: "pino-pretty"`
- `NODE_ENV=production` → `level: "info"` (or `LOG_LEVEL` override), `transport: undefined`
- missing `NODE_ENV` → same fallback as production (`info`, no transport)

`LOG_LEVEL` always has higher priority than defaults for any environment.

## Test suite boundaries

- Keep logger-specific cases in `src/__tests__/logger.test.js`.
- Keep `src/__tests__/infrastructure.test.js` for bootstrap/entry checks (`index`, `migrate`, `seed`) only.
- platform-v1 integration e2e тесты живут в `src/v1/**/__tests__/*.integration.test.js`
  и авто-skip'ятся без `TEST_DATABASE_URL` (см. ниже).

## platform-v1 integration tests

Некоторые тесты platform-v1 запускаются против реальной PostgreSQL для покрытия
end-to-end AC из спек (`docs/product/specs/platform-v1/*-spec.md` §7).
Паттерн: `describe.skip`, если не задан `TEST_DATABASE_URL` — на CI без БД не падает.

### Что покрыто

| Файл | AC спеки |
|------|----------|
| `src/v1/services/__tests__/announcements.e2e.integration.test.js` | `announcements-v2-spec.md §7` — create → publish → outbox → log_v2, counts совпадают |
| `src/v1/services/__tests__/packages.e2e.integration.test.js` | `packages-v2-spec.md §7` — receive → outbox(package.received) → pickup → outbox(package.picked_up_confirmation) → оба события в log_v2; pickup по имени (не-резидент) — confirmation outbox пуст |

Общий seed/cleanup — `src/v1/services/__tests__/_fixtures.js`
(`applyV1Migrations` / `seedFixture` / `cleanupFixture`).
Файл скрыт от jest testMatch через `testPathIgnorePatterns: ["/__tests__/_"]`
в `backend/package.json` — `_*.js` под `__tests__/` не считается тестом.

### Запуск

```bash
# 1. Локальный Postgres (docker или нативный), пустая БД:
createdb domhub_v1_test

# 2. Расширение для gen_random_uuid() — тест применит само, но требует прав:
psql domhub_v1_test -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"

# 3. Запуск:
TEST_DATABASE_URL=postgres://localhost/domhub_v1_test \
  npx jest src/v1 --runInBand
```

Тест идемпотентно применяет `V1_PROPERTY_MIGRATIONS` в `beforeAll`.
Для чистой среды после прогона можно `DROP DATABASE domhub_v1_test` и пересоздать.

## Merge gate (required)

Before merging:

1. `cd backend && npm test`
2. `cd frontend && npm test -- --watchAll=false`

## Refresh legacy fallback flag

- `REFRESH_LEGACY_FALLBACK_ENABLED=0` is the secure default for normal operation.
- Set `REFRESH_LEGACY_FALLBACK_ENABLED=1` only as a temporary migration mode when you still have legacy refresh rows stored as raw token ids (`id=rawToken`).
- After migration completes, return the flag to `0` immediately. While `=1`, backend keeps a warning log on startup and can increment legacy fallback metrics during `/api/auth/refresh`.
