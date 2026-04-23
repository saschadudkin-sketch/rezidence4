# loadtest/ — k6 нагрузочные тесты

Сценарии на [k6](https://k6.io/) — open-source нагрузочный инструмент от Grafana.
Каждый `*.js` файл — самостоятельный тест с собственными метриками, thresholds и env-контрактом.

Общий принцип: **load-test запускается против staging-инстанса**, не против production и не против локальной dev-БД без подготовки. Результаты пишутся в `loadtest/results-*.json` и не коммитятся (см. root `.gitignore`).

## Сценарии

| Файл | Цель | AC источник |
|------|------|-------------|
| `requests.js` | GET/POST `/api/requests` — базовый smoke | FIX [T2] (legacy) |
| `outbox_fanout.js` | LOAD-1: `announcement.published` fan-out throughput | `docs/product/specs/platform-v1/notifications-outbox-spec.md` §6 |

## Установка k6

- macOS: `brew install k6`
- Linux: [packages page](https://grafana.com/docs/k6/latest/set-up/install-k6/)
- Windows: `choco install k6` или `winget install k6`
- Docker: `docker run --rm -i grafana/k6 run - < loadtest/<script>.js`

Минимальная проверка: `k6 version`.

## Общий контракт env

Все сценарии используют одинаковый подход к конфигу через `-e KEY=VALUE`:

| Var | Что | Default |
|------|------|--------|
| `BASE_URL` | backend root (без trailing slash) | `http://localhost:3001` |
| `TEST_TOKEN` | JWT staff/admin (cookie-scheme `token=...`) | **required** |
| `PROPERTY_SLUG` | `X-Property-Slug` header (hybrid tenant resolver) | **required для v1** |
| `PROPERTY_ID` | UUID property для body-параметра | **required для create** |

## LOAD-1: `outbox_fanout.js`

### Acceptance criteria

Из `notifications-outbox-spec.md` §6:

> **LOAD-1:** при rate 100 req/s с `announcement.published` на 500 резидентов outbox заполняется за < 30 секунд, worker успевает обрабатывать fanout без back-pressure collapse.

### Что меряется

1. **`announcement_publish_latency_ms`** — HTTP p95 `POST /publish`. Publish транзакционен, включает INSERT outbox rows; threshold `p95 < 2000 ms`.
2. **`announcement_fanout_rows`** — Trend значений `outbox_fanout` из каждого publish response.
3. **`announcement_fanout_shortfall`** — Counter, инкрементируется когда fan-out rows < `EXPECTED_FANOUT`. Threshold `count < 10` — несколько shortfall'ов допустимы на граничные случаи (только что добавленный резидент без channel'ов), systemic отказ audience-резолва будет > 10.
4. **`errors`** — Rate неудачных запросов (HTTP !=2xx / невалидный JSON). Threshold `< 1%`.
5. **`http_req_failed`** — k6-builtin, mirror проверки выше.

Teardown делает одиночный `GET /api/v1/admin/outbox/metrics` — снимок состояния очереди после прогона; логируется в stdout для offline-разбора.

### Prerequisites (setup)

1. **Backend в load-test mode:**
   ```
   NODE_ENV=production
   NOTIFICATIONS_OUTBOX_ENABLED=true
   # worker активен (проверить /api/v1/admin/outbox/health → "running": true)
   ```

2. **Seed 500 резидентов** в целевой property:
   - В `residents` table должно быть ≥ `EXPECTED_FANOUT` active rows (deleted_at IS NULL, status='active').
   - Каждый привязан к `units` → `buildings` → `properties` → `property_id = PROPERTY_ID`.
   - У каждого — хотя бы один активный notification channel:
     - `push_subscriptions.is_active=true` (для `web_push` канала), или
     - `resident_contact_channels` с `verified_at IS NOT NULL`.

   В Phase 5 нет готового seed-скрипта; создаётся вручную через admin-API / SQL-фикстуры staging'а. BACKLOG: `LOAD-SEED-1` — автоматизированный seed (см. `BACKLOG.md`).

3. **Bypass rate-limits на load-test инстансе.** Production-backend имеет `createLimiter = 10/hour/user` на `POST /api/v1/announcements` (spec §4). Для 100 RPS это упрётся на 10-м запросе. Варианты:

   **Вариант A — отдельный staging с patched кодом** (рекомендуется):
   Скопировать routes/announcements.js на staging, закомментировать `createLimiter` и `urgentPublishLimiter`, задеплоить. После прогона — revert.

   **Вариант B — env-flag** (requires code change, не включено в этот PR):
   Добавить `ANNOUNCEMENTS_SKIP_RATE_LIMITS=1` hook на скип `createLimiter`/`urgentPublishLimiter`. См. BACKLOG `LOAD-ENV-FLAG`.

   **Вариант C — пре-сидинг драфтов через прямой SQL** и скрипт который только делает publish (без create). Тогда create-limiter обходится естественно, но требует альтернативного варианта скрипта — `outbox_fanout_preseeded.js` (не включено в v1).

4. **Admin JWT** со scope `property_admin` для `PROPERTY_SLUG`. Генерация — обычным `/api/auth/login` от admin-аккаунта + копирование cookie `token` в `TEST_TOKEN`.

### Запуск

**Production-рейт (LOAD-1 AC):**
```bash
k6 run loadtest/outbox_fanout.js \
  -e BASE_URL=https://staging.example.com \
  -e TEST_TOKEN="$LOAD_JWT" \
  -e PROPERTY_SLUG=zamoskvorechye \
  -e PROPERTY_ID=00000000-0000-0000-0000-000000000001 \
  -e TARGET_RPS=100 \
  -e DURATION=60s \
  -e EXPECTED_FANOUT=500
```

**Локальный smoke** (не LOAD-1 AC, быстрая проверка что сценарий вообще работает):
```bash
k6 run loadtest/outbox_fanout.js \
  -e BASE_URL=http://localhost:3001 \
  -e TEST_TOKEN="$DEV_JWT" \
  -e PROPERTY_SLUG=dev \
  -e PROPERTY_ID=<dev-uuid> \
  -e TARGET_RPS=5 \
  -e DURATION=10s \
  -e EXPECTED_FANOUT=3
```

### Что считаем «passed»

Все thresholds зелёные:
- `announcement_publish_latency_ms p(95) < 2000` — backend тянет 100 RPS publish без деградации.
- `http_req_failed rate < 0.01` — меньше 1% HTTP ошибок.
- `errors rate < 0.01` — меньше 1% application-level ошибок.
- `announcement_fanout_shortfall count < 10` — audience резолвится стабильно.

Плюс в teardown-логе: `oldest_pending_age_s` из outbox metrics **< 30** — worker не отстаёт от producer на >30 секунд (это и есть LOAD-1 AC про «outbox заполняется за <30s», переформулированное).

### Что делать если упало

- **p95 latency растёт линейно с duration** → тюнить pg-pool (`max` в `backend/src/db.js`), index'ы на `notifications_outbox (status, created_at)`.
- **dropped_iterations > 0** → backend не вытягивает заявленный rate; k6 не смог выдать 100 RPS. Смотри `maxVUs` — либо недостаточно VU, либо (чаще) backend p95 > 1s и VU не возвращаются в пул.
- **fanout_shortfall высокий** → seed 500 резидентов неполный; audience резолвит <500. SQL-чек: `SELECT count(*) FROM residents WHERE property_id=$1 AND deleted_at IS NULL AND status='active'`.
- **oldest_pending_age_s растёт без границ** → worker не успевает. Масштабировать worker (несколько инстансов с advisory-lock-based leasing), или батчить adapter sends.

### Не цели этого сценария

- Тестирование отдельных channel adapter'ов (web_push, email провайдеров) — это LOAD-2/3 (BACKLOG, Phase 6).
- Долгоживущая нагрузка > 5 минут — k6 cloud для endurance-test, вне этого скрипта.
- Chaos-injection (kill worker, сеть падает) — отдельная chaos-тестовая среда.
