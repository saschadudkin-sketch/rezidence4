# API Documentation

Source-of-truth для DomHub API contract — `docs/openapi.json` (OpenAPI 3.0.3).

## Что покрыто

| Префикс | Routes | Уровень детализации |
|---------|--------|---------------------|
| `/api/v1/auth/*` | send-otp, refresh | response codes + base schemas |
| `/api/v1/requests/*` | list, create, patch | response codes + RequestItem stub |
| `/api/v1/users/*` | list, restore | response codes + User schema |
| `/api/v1/upload/*` | photo | UploadResponse |
| `/api/v1/chat/*` | messages | ChatMessage stub |
| `/api/v1/passes/*` | list, create, get, qr, regenerate-qr, revoke/block/unblock | **полные схемы** (Pass, PassQR, transition commands) |
| `/api/v1/announcements/*` | list, create, get, patch, delete, publish, admin-list | **полные схемы** (Announcement) |
| `/api/v1/packages/*` | list, create, get, patch | **полные схемы** (Package) |
| `/api/v1/documents/*` | list, create, get, patch | полные схемы (Document) |
| `/api/v1/access-requests/*` | list, create, detail, submit/approve/reject/cancel/escalate | полные схемы (AccessRequest, structured 409) |
| `/api/v1/visits/*` | list, verify | VerifyPassResponse детально |
| `/api/v1/guard/*` | scan-pass | VerifyPassResponse детально |
| `/api/v1/access-zones/*`, `/api/v1/access-points/*` | list, create, patch, deactivate | схемы topology entities |
| `/api/v1/access-policies/*` | templates, list, create, get, patch, evaluate, deactivate | схемы policy + decision |
| `/api/v1/security-workspace/*` | bootstrap/dashboard/search/recent, manual decisions, offline replay, degraded reconcile | manual-decision контракт детализирован |
| `/api/v1/access-incidents/*` | list, create, get, assign/resolve/dismiss/status/reopen, patch | схемы incident lifecycle |
| `/api/v1/access-overrides/*` | list, get, create | схемы override audit path |
| `/api/v1/vehicles/*` | list, create, get, by-plate, patch flags/metadata, compatibility commands, delete | схемы Vehicle + flag PATCH |
| `/api/v1/residents` | list | stub |
| `/api/v1/staff` | list | stub |
| `/api/v1/contractors` | list | stub |
| `/api/v1/structure` | get | stub |
| `/api/v1/notification-log` | list | stub |
| `/api/v1/admin/outbox` | list | stub |

**Итого:** 300 paths, 97 schemas, 368 operations. Coverage проходит `npm run openapi:drift`, который проверяет не только mounted prefixes, но и операции внутри Express router'ов, смонтированных под `/api/v1/*`. Access-domain пилотные маршруты имеют явные path/schema anchors, включая stale-state 409, manual security decisions и trusted visitors.

## Что ещё нужно детализировать

- **Generated operation anchors** — live route coverage полная, но 207 операций пока имеют generic `{ type: object }` request/response schemas. При следующем проходе по конкретному route нужно заменить generic schema на `*Create` / `*Update` / `*Response` schema.
- **Параметры query** — часть list endpoints принимает query (status filter, pagination), это нужно описать в endpoint-specific schemas.
- **Pagination** — все list endpoints возвращают плоские массивы без cursor/page (см. audit gap про LIMIT 500). Когда введём pagination, обновить response schemas.
- **Authentication details** — `securitySchemes` теперь фиксирует JWT cookie и `X-Property-Slug`; per-route capability matrix остаётся в markdown spec'ах и backend authz tests.
- **Tags + descriptions** — теги проставлены, но без top-level `tags[]` array с описаниями.

## Cross-cutting headers

### `Idempotency-Key`

POST mutations поддерживают опциональный `Idempotency-Key` header (≤256 chars). При наличии и совпадении ключа в течение 24 часов middleware вернёт **закешированный 2xx-ответ** вместо повторного выполнения handler'а — защита от double-tap / network retry.

**Где включено сейчас:**
- `POST /api/v1/passes` — create pass
- `POST /api/v1/passes/{id}/regenerate-qr` — regenerate QR

**Поведение:**
- Кешируются только 2xx ответы (4xx/5xx — повтор приведёт к новому handler call)
- Cache key изолирован по user uid (`idem:{uid}:{key}`) — нет утечек между пользователями
- TTL 24h, fallback на in-memory Map если REDIS_URL не задан

**Implementation:** `backend/src/middleware/idempotency.js` (один singleton-Redis client через `lib/redisClient.js`).

**Что ещё нужно подключить (follow-up):**
- POST `/api/v1/announcements`, `/announcements/{id}/publish`
- POST `/api/v1/packages`
- POST `/api/v1/documents`
- POST `/api/v1/access-requests`
- POST `/api/v1/access-incidents`
- POST `/api/v1/vehicles`

State-mutating endpoints с встроенной семантической идемпотентностью (revoke/block/unblock — возвращают 409 при повторе) middleware **не требуют** — 409 информативнее.

## Как расширять

1. **Новый endpoint:** добавить запись в `paths` с минимум: `responses.200`, `responses.4xx`. Создать schema-stub в `components.schemas` (`{ "type": "object" }` если контракт ещё не утвердился).
2. **Заполнение существующего:** заменить stub на полную схему. Идеал — все required + nullable + enum для статусов.
3. **Verification:** `npm run test:contract` (если будет такой target) или просто `node -e "JSON.parse(require('fs').readFileSync('docs/openapi.json','utf-8'))"` локально.

## Runtime endpoints для spec

- `GET /api/docs/openapi.json` — машинно-читаемый spec (см. `backend/src/app/registerObservabilityRoutes.js`)
- Frontend contract test: `frontend/src/services/http/openapiContract.test.tsx`

## Связь со spec'ами модулей

Каждая platform-v1 фича имеет markdown-spec в `docs/product/specs/platform-v1/*-spec.md` где описаны:
- Acceptance criteria
- Capability matrix (кто что может)
- Rate limits
- State machines

OpenAPI отвечает на вопрос «как выглядит wire format»; spec'ы — «почему именно так». Эти два документа дополняют друг друга, не дублируют.

## Известные несоответствия

- Часть legacy routes под `/api/*` (без `/v1`) пока не покрыта — это endpoint'ы из `backend/src/routes/*` которые v1 ещё не заменил. По мере миграции v1 их можно либо удалить из spec'а (если уходят в depreciation), либо документировать с `deprecated: true`.
