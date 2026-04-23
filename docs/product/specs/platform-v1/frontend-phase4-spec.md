# Frontend Phase 4 — Access-core UI (platform-v1)

**Статус:** done (2026-04-23)
**Ветка:** `platform-v1`
**Зависит от:** Фаза 3 (commit `cd0c22e`) — backend access-core endpoints

Связанные спеки:
- [access-requests-spec.md](./access-requests-spec.md)
- [passes-spec.md](./passes-spec.md)
- [qr-verification-spec.md](./qr-verification-spec.md) — **prod-mount = `/api/v1/visits/verify`** (спека говорит `/api/v1/passes/verify`; импл и Фаза 4 UI идут по actual mount)
- [vehicles-spec.md](./vehicles-spec.md)
- [access-incidents-spec.md](./access-incidents-spec.md)
- [units-spec.md](./units-spec.md)
- [residents-spec.md](./residents-spec.md)

---

## 1. Цель Фазы

Дать работающий UI поверх backend access-core, не ломая legacy-фронт. Резидент оформляет заявку, охранник проверяет QR/номер и управляет пропусками, консьерж видит полную lifecycle-карту заявки. Всё это живёт в `frontend/src/v1/` и не импортирует ничего из legacy.

### Acceptance (для закрытия фазы)

1. **Resident flow.** Авторизованный owner/tenant:
   - видит свои активные заявки и может создать новую (POST `/api/v1/access-requests`)
   - форма требует `target_unit_id`, `request_type`, окно `starts_at/ends_at`; `vehicle_id` — опционален (обязателен только для `request_type=vehicle_access`)
   - сразу после создания видит заявку в списке с её `status` и, если она `approved`, — `pass_id` + QR-токен под капотом (QR-страница — legacy, в Фазе 4 не трогаем)
2. **Guard console.**
   - Сканирование QR (текстовый ввод токена в MVP; камера — отдельный опц. модуль, не блокер) → POST `/api/v1/visits/verify` → показать verdict (`allowed/reason`) + карточку pass'а, если найден
   - Сканирование номера авто (введённый plate) по тому же endpoint
   - Список активных пропусков объекта (filter: `status=active`), с кнопкой `revoke` (POST `/api/v1/passes/:id/revoke`)
   - Поиск авто по номеру: GET `/api/v1/vehicles/by-plate/:plate` — показать состояние whitelisted/blacklisted
3. **Concierge detail.**
   - GET `/api/v1/access-requests/:id` показывает lifecycle-карточку: саму заявку, approvals, выписанный pass, последние visit-logs по pass'у, связанные incidents
   - Admin/concierge может approve/reject/escalate заявку (кнопки вызывают соответствующие POST)
4. **Roles & guards.** `/v1/resident/*` пускает только resident-роли (owner/tenant/contractor); `/v1/guard/*` — только security/admin; `/v1/concierge/*` — только concierge/admin. Неавторизованный пользователь редиректится через существующий auth-flow (Фаза 4 не пересобирает авторизацию — используем тот же cookie-JWT).
5. **Lint + typecheck + тесты зелёные**: `frontend: npm run lint`, `npm run typecheck`; backend не трогаем, но запускаем `test:ci` для регресса.

### Out of scope (deferred)

- Нативная камера для QR (отдельная мобильная оболочка P2)
- Household co-approval UI (P1 households — см. BACKLOG P1-3)
- Incident-инспектор UI (открытие/присваивание/резолв) — сделаем в Фазе 5 или отдельным тикетом; для концьержа Фазы 4 incidents отображаются read-only как часть карточки заявки
- SSE live-updates — Фаза 4 использует query-refetch после мутаций; SSE для v1 — Фаза 6/7
- Мобильная оптимизация пакет за пакетом — только базовая адаптивка через design-tokens

---

## 2. Структурные принципы `frontend/src/v1/`

Следуем D-lite §2 "v1 не импортирует из legacy". Единственные внешние зависимости кода Фазы 4:

- React / React-DOM (уже в проекте)
- React Router v7 (подключение через новый `v1/router.tsx` + вклинивание в корневой `App.tsx`)
- React Query (для imperative reads — списки, детали)
- Vitest + @testing-library/react (тесты)
- design-system токены через CSS-переменные (`frontend/src/design-system/tokens.css`) — токены это контракт, а не компоненты; импорт CSS-переменных через имена, не через JS-модули

### Раскладка директорий

```
frontend/src/v1/
├── api/
│   ├── types.ts              # ресурсные типы (AccessRequest, Pass, Vehicle, …)
│   ├── client.ts             # fetch-обёртка (cookie + CSRF + retry + timeout)
│   ├── errors.ts             # V1ApiError + классификация (auth/forbidden/conflict/…)
│   ├── accessRequests.ts
│   ├── passes.ts
│   ├── vehicles.ts
│   ├── visits.ts
│   ├── accessIncidents.ts
│   ├── units.ts              # только read-by-id для формы резидента
│   ├── residents.ts          # только /me → self-info
│   └── index.ts              # barrel
├── store/
│   ├── session.ts            # Context + hook useV1Session (me, role, propertyId)
│   └── accessData.ts         # локальное состояние заявок/пропусков страницы (React Query cache — основной слой; здесь только UI-state вида "выбранная вкладка")
├── components/
│   ├── AccessRequestForm.tsx         # резидент создаёт заявку
│   ├── AccessRequestCard.tsx         # summary-карточка заявки
│   ├── AccessRequestLifecycle.tsx    # approvals + pass + visit-logs + incidents
│   ├── PassCard.tsx
│   ├── VehicleCard.tsx
│   ├── VerifyResultCard.tsx          # результат /visits/verify
│   ├── ScanPanel.tsx                 # QR / plate input
│   ├── RoleGate.tsx                  # клиентский guard вокруг страниц
│   ├── ErrorBoundary.tsx
│   └── ui/                           # минимальные примитивы (Button, Input, Select, Badge, Spinner, EmptyState, FieldError)
├── pages/
│   ├── ResidentAccessPage.tsx
│   ├── GuardConsolePage.tsx
│   └── ConciergeRequestDetailPage.tsx
├── router.tsx                 # массив RouteObject для /v1/*
└── index.ts                   # экспорт router + AppV1Provider
```

**Ui-примитивы (`components/ui/`)** — осознанно дублируем минимум, чтобы не тянуть `frontend/src/design-system/components/*.tsx` (они привязаны к legacy-сторям и event-bus'у). Используем только токены (цвета/радиусы/шрифт/пробелы) через CSS-классы из `design-system/tokens.css`. Новых SCSS не добавляем — каждый компонент v1 идёт с локальным CSS-модулем `Component.module.css` или inline-className через токены.

### ESLint / TypeScript

- Новый модульный alias не нужен: существующий `@/` из `tsconfig.json` указывает на `frontend/src`; `@/v1/...` работает автоматически.
- Включаем тот же `strict` TS-набор, что и основной проект (он уже global).
- `no-restricted-imports` будет предупреждать при попытке импорта из `frontend/src/{store,services,components,requests,views}`. Добавляем правило в `frontend/eslint.config.js` в блок, относящийся к `src/v1/**`.

---

## 3. API layer (`v1/api/*`)

### 3.1 `types.ts`

Отражает точные формы ответов backend (см. route-файлы). Ключевые:

```ts
export type UUID = string;
export type RequestType = 'guest' | 'courier' | 'service' | 'vehicle_access';
export type RequestStatus =
  | 'draft' | 'submitted' | 'approved' | 'rejected'
  | 'cancelled' | 'escalated' | 'expired';
export type PassStatus = 'active' | 'used' | 'revoked' | 'blocked' | 'expired';
export type PassType = 'guest' | 'courier' | 'service' | 'resident' | 'staff' | 'vehicle';
export type SubjectType = 'guest' | 'resident' | 'staff' | 'contractor_user' | 'vehicle';
export type IncidentType =
  | 'expired_pass_attempt' | 'invalid_qr' | 'blacklist_hit'
  | 'outside_time_window' | 'unauthorized_vehicle' | 'manual_override'
  | 'provider_conflict' | 'suspicious_repeat_attempt';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
export type VerifyMode = 'qr' | 'plate';
export type DenyReason =
  | 'invalid_qr' | 'vehicle_blacklisted' | 'pass_revoked' | 'pass_blocked'
  | 'pass_used' | 'expired' | 'outside_time_window' | 'unauthorized_vehicle';

export interface AccessRequest { /* id, property_id, target_unit_id, created_by_*, request_type, visitor_name/phone, vehicle_id, starts_at, ends_at, approval_required, status, created_at, … */ }
export interface AccessApproval { /* id, access_request_id, approved_by_staff_id, decision, comment, created_at */ }
export interface Pass { /* id, property_id, access_request_id, pass_type, subject_type, subject_*_id, valid_from, valid_until, status, revoked_{at,by,reason}, created_at */ }
export interface QrToken { token: string; expires_at: string; }
export interface Vehicle { id: UUID; property_id: UUID; owner_type: 'resident'|'contractor'|'guest'|'property'; owner_resident_id: UUID|null; owner_contractor_user_id: UUID|null; plate_number: string; make: string|null; model: string|null; color: string|null; is_whitelisted: boolean; is_blacklisted: boolean; notes: string|null; created_at: string; }
export interface VisitLog { /* id, property_id, pass_id, point_id, occurred_at, direction, event_type, plate_observed, photo_url, verification_mode */ }
export interface AccessIncident { /* id, property_id, related_*_id, incident_type, severity, status, title, description, assigned_to_staff_id, resolved_at, created_at */ }
export interface AccessOverride { /* id, incident_id, pass_id, performed_by_staff_id, override_type, reason, created_at */ }
export interface VerifyResult {
  allowed: boolean;
  reason?: DenyReason;
  visit_log_id: UUID | null;
  incident_id: UUID | null;
  pass: Pick<Pass,'id'|'pass_type'|'status'|'valid_from'|'valid_until'> | null;
}
```

Полные точные поля — в соответствующих spec-файлах. Локальные типы не добавляют поля, которых нет в ответе; вычисляемые derive-поля живут в селекторах.

### 3.2 `client.ts`

Общий fetch:

- Base URL: `'/api/v1'` (тот же origin — cookie выставлен с домена приложения)
- `credentials: 'include'` — cookie JWT уходит автоматически
- `X-CSRF-Token` для всех мутаций: читаем cookie `rz-csrf` (double-submit pattern, уже стоит проектом после `/verify-otp`; см. `frontend/src/services/http/requestIdentity.ts`). Для GET — не отправляем. Если cookie нет — mutation проваливается на 403; в Фазе 4 пользователь заранее должен был залогиниться через legacy `/login`, там cookie и выставляется.
- `X-Request-Id`: `crypto.randomUUID()`
- timeout: 10s для GET, 20s для write
- Ретраи: GET idempotent → 2 ретрая (100ms, 400ms) на сетевые ошибки и 502/503/504
- Классификация ошибок: 401 → `V1ApiError('unauthorized')` + emit session-expired event; 403 → `forbidden`; 404 → `not_found`; 409 → `conflict`; 422 → `validation`; 5xx → `server`

Сигнатура:

```ts
interface RequestOpts { signal?: AbortSignal; skipCsrf?: boolean; }
export const v1Client = {
  get<T>(path: string, opts?: RequestOpts): Promise<T>,
  post<T>(path: string, body?: unknown, opts?: RequestOpts): Promise<T>,
  patch<T>(path: string, body?: unknown, opts?: RequestOpts): Promise<T>,
  delete<T>(path: string, opts?: RequestOpts): Promise<T>,
};
```

### 3.3 Ресурсные клиенты

| Файл | Экспорт | Бэкенд |
|---|---|---|
| `accessRequests.ts` | `list(params)`, `getById(id)`, `create(body)`, `submit(id)`, `approve(id, comment?)`, `reject(id, reason)`, `cancel(id, reason?)`, `escalate(id, reason)` | `/api/v1/access-requests/*` |
| `passes.ts` | `list(params)`, `getById(id)`, `getQr(id)`, `regenerateQr(id)`, `revoke(id, reason)`, `block(id, reason)`, `unblock(id)` | `/api/v1/passes/*` |
| `vehicles.ts` | `list(params)`, `getByPlate(plate)`, `getById(id)`, `create(body)`, `update(id, body)`, `whitelist(id)`, `blacklist(id, reason)`, `clearFlags(id)` | `/api/v1/vehicles/*` |
| `visits.ts` | `verify(body)`, `list(params)` | `/api/v1/visits/*` |
| `accessIncidents.ts` | `list(params)`, `getById(id)` | `/api/v1/access-incidents/*` (read-only в Фазе 4) |
| `units.ts` | `list(params)` | `/api/v1/units` |
| `residents.ts` | `listMyHousehold()` — MVP: `GET /api/v1/residents?owner_uid=self` (если backend не поддерживает — UI вытягивает из `/api/v1/auth/me` и показывает единственный unit текущего резидента) | `/api/v1/residents/*` |

**Замечание про резидента.** Legacy JWT не содержит `resident_id/unit_id`; резидент знает свой unit через `/api/v1/users/me` (legacy). В Фазе 4 для формы заявки мы:
1. Берём `uid` текущего юзера из session-context (уже есть).
2. Вызываем `GET /api/v1/residents?owner_uid=<uid>` — backend вернёт список резидентов, привязанных к пользователю (если endpoint не поддерживает owner_uid, fallback: `GET /api/v1/residents` + клиентский фильтр по `is_active` — но это ломает tenancy). **Action item**: перед реализацией проверить `backend/src/v1/routes/residents.js` на поддержку фильтра; при отсутствии — добавить минимальный filter `?is_active=true` и полагаться на то, что у резидента правильный tenant scope через middleware. Если добавить придётся — делаем как отдельный хотфикс и отмечаем в ROADMAP.

---

## 4. Store (`v1/store/*`)

Сессия и данные — разные слои.

### 4.1 `session.ts`

```ts
export interface V1Session {
  uid: UUID;
  role: 'owner' | 'tenant' | 'contractor' | 'concierge' | 'security' | 'admin';
  propertyId: UUID | null;
  displayName: string;
}
export const V1SessionContext: React.Context<V1Session | null>;
export function useV1Session(): V1Session;   // throws if missing
export function useV1SessionOpt(): V1Session | null;
```

`AppV1Provider` при монтировании:
1. `GET /api/v1/auth/me` (legacy endpoint из `backend/src/routes/auth.js:365`)
2. Кэшит в Context
3. На 401 — перекидывает через `window.location.assign('/login')` (legacy-логин; v1 не строит свой)

### 4.2 `accessData.ts`

React Query используем как основной кэш, store'у остаётся только UI-state (текущая вкладка, selected pass в guard-console). Поэтому `accessData.ts` — это namespaced react-query keys + инвалидаторы:

```ts
export const qk = {
  accessRequests: {
    list: (p?: ListParams) => ['v1','access-requests','list', p ?? null] as const,
    byId: (id: UUID) => ['v1','access-requests','byId', id] as const,
  },
  passes: { list: (p?: ListParams) => ['v1','passes','list', p ?? null] as const, byId: (id: UUID) => ['v1','passes','byId', id] as const, qr: (id: UUID) => ['v1','passes','qr', id] as const },
  vehicles: { list: (p?: ListParams) => ['v1','vehicles','list', p ?? null] as const, byPlate: (plate: string) => ['v1','vehicles','byPlate', plate] as const },
  visits:   { list: (p?: ListParams) => ['v1','visits','list', p ?? null] as const },
  incidents:{ list: (p?: ListParams) => ['v1','access-incidents','list', p ?? null] as const, byId: (id: UUID) => ['v1','access-incidents','byId', id] as const },
};
export function invalidateAccessRequest(id: UUID, qc: QueryClient): void; // инвалидирует accessRequests.byId(id) + связанные passes.list
```

---

## 5. Страницы

### 5.1 ResidentAccessPage (`/v1/resident/access`)

Layout: шапка с приветствием, кнопка «Новая заявка», список своих заявок (сорт по `created_at DESC`), под каждой — status-pill + `starts_at..ends_at` + visitor_name/plate. Click → expanded card с QR-кнопкой (opens legacy `/p/:token` в новой вкладке, если есть `pass_id`).

Форма `AccessRequestForm`:
- **Поля**: target_unit_id (select из резидентских unit'ов — обычно 1, но мультю-unit допускаем), request_type (radio: guest/courier/service/vehicle_access), visitor_name (text), visitor_phone (text, optional), vehicle_id (vehicle-picker, обязателен при vehicle_access), starts_at/ends_at (datetime-local с дефолтом «сейчас» + «сейчас+4ч»), comment (textarea, optional)
- **Валидация клиента**: request_type required; если vehicle_access → vehicle_id required; окно: `starts_at < ends_at`, обе даты > сейчас-15мин; visitor_name required для guest/courier/service
- **Submit**: POST `/api/v1/access-requests` (без `submit=true` — сначала draft, потом если approval не требуется — submit-кнопка; но MVP: бэк auto-submit'ит через отдельный endpoint) → при успехе модалка закрывается, список инвалидируется
- **Ошибки**: 400/422 → показать по полю; 403 → toast «Нет прав»; 409 → «Конфликт статусов, обновите страницу»

**Vehicle-picker**: компактный UX — list резидентских авто по `GET /api/v1/vehicles?owner_resident_id=<me>` (если endpoint это поддерживает; иначе `?owner_type=resident` + клиентская фильтрация) + кнопка «добавить авто», которая открывает форму POST `/api/v1/vehicles` (plate_number обязателен, make/model/color optional). Сразу после create — select новое авто.

### 5.2 GuardConsolePage (`/v1/guard`)

Layout: две колонки (или стеком на узких экранах).

**Левая — Scan panel**:
- Radio: режим QR / plate
- Input: token (QR) или plate-number (plate)
- Submit → POST `/api/v1/visits/verify` → VerifyResultCard показывает:
  - allowed=true: зелёный, `event_type=entry_allowed`, сам pass (type, subject, window), CTA «Открыть карточку заявки»
  - allowed=false: красный, `reason` в читаемом виде, severity badge, ссылка на incident (если incident_id)
- История последних 20 сканов — из локального React-state (не сервера; это UX-шпаргалка для охранника смены)

**Правая — Passes & Vehicles**:
- Таб «Активные пропуска»: `GET /api/v1/passes?status=active&limit=100` с поиском (plate | visitor | pass_id-суффикс). Каждая строка — PassCard: type, subject, окно, кнопка «Отозвать» (POST `/api/v1/passes/:id/revoke` с inline-reason input'ом)
- Таб «Авто»: поиск по номеру → GET `/api/v1/vehicles/by-plate/:plate` → VehicleCard с флагами whitelist/blacklist; CTA «Внести в ЧС» (POST `/api/v1/vehicles/:id/blacklist`) и «В белый список» / «Сбросить флаги»

Все мутации инвалидируют соответствующий react-query-list.

**Роль-гейт**: только `role ∈ {security, admin}`.

### 5.3 ConciergeRequestDetailPage (`/v1/concierge/access/:requestId`)

Карточка заявки:
- Header: visitor_name, request_type, status-pill, window
- Секция «Заявка»: все поля + comment
- Секция «Approvals»: хронология (created_at, approved_by_staff, decision, comment). Для pending заявки — inline панель с кнопками Approve / Reject / Escalate (admin/concierge), reject/escalate требуют reason.
- Секция «Pass»: PassCard + история visit_logs по pass_id (`GET /api/v1/visits?pass_id=<id>`)
- Секция «Incidents»: `GET /api/v1/access-incidents?related_pass_id=<pass_id>` (если backend не поддерживает фильтр — клиентская фильтрация из `list()` + лимит) — read-only карточки; нет управления в Фазе 4

Все три кнопки одной формы: лёгкий confirm-диалог с textarea для reason.

**Роль-гейт**: `role ∈ {concierge, admin}`.

---

## 6. Маршрутизация

`frontend/src/v1/router.tsx` экспортирует массив `RouteObject[]`:

```
/v1/resident/access                    → ResidentAccessPage
/v1/guard                              → GuardConsolePage
/v1/concierge/access/:requestId        → ConciergeRequestDetailPage
/v1/*                                  → Navigate to /v1/{home-for-role}
```

В `App.tsx` добавляется обёртка `<Route path="/v1/*" element={<AppV1Provider><V1Outlet /></AppV1Provider>} />` между блоком `/dashboard/*` и `/guard/scan`. Legacy-маршруты остаются нетронутыми.

`RoleGate` — клиентский: если `session.role` не в списке allowed → `<Navigate to="/" replace>`.

---

## 7. Тесты

Vitest + Testing Library; без DOM-snapshot'ов (они хрупкие), только поведение.

Минимальный набор для acceptance:

| Файл | Что проверяем |
|---|---|
| `api/__tests__/client.test.ts` | Success 200 → parsed JSON; 401 → V1ApiError unauthorized + emits session-expired; 409 → V1ApiError conflict; 2 retry'я на 503; timeout → ошибка; CSRF заголовок добавлен для POST |
| `api/__tests__/accessRequests.test.ts` | Все методы строят корректный URL и тело (моки на client) |
| `api/__tests__/visits.test.ts` | verify: QR-режим отправляет token, plate-режим отправляет plate; normalise plate → UPPER без пробелов |
| `components/__tests__/AccessRequestForm.test.tsx` | Валидация: vehicle_access без vehicle_id → ошибка; ends_at ≤ starts_at → ошибка; успешный submit вызывает client.create; 422 ответ маппится на field-error |
| `components/__tests__/ScanPanel.test.tsx` | Смена режима QR↔plate; submit вызывает visits.verify с правильным телом; отображение allowed и deny ветвей |
| `components/__tests__/AccessRequestLifecycle.test.tsx` | Рендерит approvals/pass/visit-logs/incidents из props; показывает "нет" когда пусто |
| `store/__tests__/session.test.tsx` | useV1Session кидает, если нет Provider; useV1SessionOpt возвращает null |
| `router.test.tsx` | Роль-гейт: security попадает на /v1/guard, owner — редиректится |

Цель покрытия: ~25–30 новых тестов; не гоняемся за числом, гоняемся за критическими ветками.

---

## 8. Deprecation / Migration notes

- **qr-verification-spec.md §2**: говорит mount `/passes/verify`; impl и Фаза 4 используют `/visits/verify`. В Фазе 4 добавить заметку в раздел "История изменений" спеки qr-verification + footnote в access-requests-spec. Бэкенд цепочку менять не будем.
- Legacy resident-UI (`frontend/src/requests/CreateModal.tsx`) продолжает работать параллельно. Флаг-переключатель «новый UI» — в scope Фазы 7 (см. ROADMAP). В Фазе 4 просто публикуем `/v1/resident/access` как доступный через прямую ссылку.

---

## 9. Риски и меры

| Риск | Митигация |
|---|---|
| Backend-endpoint для `vehicles?owner_resident_id=<me>` не возвращает нужный фильтр | Добавить фильтр в `backend/src/v1/routes/vehicles.js` как часть Фазы 4; если времени нет — MVP показывает ручной ввод plate и создаёт vehicle сразу (POST vehicles; backend нормализует дубли 409) |
| `residents?owner_uid=<uid>` не реализован | Падаем на `GET /api/v1/auth/me` (legacy) + один `GET /api/v1/units/:id` — этого достаточно для single-unit резидента (99% case). Multi-unit оставляем на Фазу 5 |
| React Query в проекте | **Проверено**: `@tanstack/react-query@5.96.1` установлен (`frontend/package.json`). Используем |
| design-system токены в CSS-vars | **Проверено**: `frontend/src/design-system/tokens.css` содержит весь набор (цвета, spacing, radius, shadow, typography). Импортируем через `@import` в корневом стиле v1 |
| `@tanstack/react-virtual` для больших списков | Есть (`^3.13.23`), но в Фазе 4 списки ≤100 строк — virtualization не нужна |

---

## 10. Определение "Фаза 4 завершена"

1. Все 3 страницы доступны по маршрутам, авторизуются правильной ролью, пропускают happy-path сценарий из §1.
2. `npm --prefix frontend run lint` и `npm --prefix frontend run typecheck` — exit 0.
3. `npm --prefix frontend run test` — все новые + старые зелёные.
4. `npm --prefix backend run test:ci` — зелёный (регресс-проверка).
5. `ROADMAP.md §Фаза 4` и `BACKLOG.md ## Done` обновлены.
6. Один коммит `Add platform-v1 Phase 4: Access-core UI (D-lite)` на ветке `platform-v1`.
