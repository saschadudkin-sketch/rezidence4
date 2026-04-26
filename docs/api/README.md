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
| `/api/v1/passes/*` | list, create, get, patch, qr, regenerate-qr | **полные схемы** (Pass, PassQR) |
| `/api/v1/announcements/*` | list, create, get, patch, delete, publish, admin-list | **полные схемы** (Announcement) |
| `/api/v1/packages/*` | list, create, get, patch | **полные схемы** (Package) |
| `/api/v1/documents/*` | list, create, get, patch | полные схемы (Document) |
| `/api/v1/access-requests/*` | list, create, patch | полные схемы (AccessRequest) |
| `/api/v1/visits/*` | list, verify | VerifyPassResponse детально |
| `/api/v1/access-incidents/*` | list, create | stub |
| `/api/v1/vehicles/*` | list, create | stub |
| `/api/v1/residents` | list | stub |
| `/api/v1/staff` | list | stub |
| `/api/v1/contractors` | list | stub |
| `/api/v1/structure` | get | stub |
| `/api/v1/notification-log` | list | stub |
| `/api/v1/admin/outbox` | list | stub |

**Итого:** 33 paths, 49 schemas. Coverage v1 routes ~85% (по path count), детализация unevenly — высокотрафиковые (passes/announcements/packages) заполнены, остальные — placeholder'ы для постепенного наполнения.

## Что НЕ покрыто (и должно быть)

- **Request bodies** — почти везде `requestBody` не задан. При следующем проходе по конкретному route нужно добавить `requestBody.content.application/json.schema` со ссылкой на `*Create` / `*Update` schema.
- **Параметры query** — задано только для passes; остальные list endpoints принимают query (status filter, pagination), это нужно описать.
- **Pagination** — все list endpoints возвращают плоские массивы без cursor/page (см. audit gap про LIMIT 500). Когда введём pagination, обновить response schemas.
- **Authentication** — `securitySchemes` и `security` не задано; сейчас все non-`auth/*` endpoint'ы требуют JWT cookie + `X-Complex-Slug` header. Документируем после введения OAuth-style description.
- **Tags + descriptions** — теги проставлены, но без top-level `tags[]` array с описаниями.

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
