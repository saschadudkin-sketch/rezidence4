# DomHub — Integration Architecture Specification

Дата: 2026-04-21  
Статус: рабочая integration architecture specification  
Назначение: определить, как DomHub должен интегрироваться с внешними системами доступа, уведомлений и смежными системами эксплуатации.

---

## 1. Цель документа

Документ определяет:
- какие классы интеграций поддерживает DomHub;
- какие принципы должны соблюдать интеграции;
- что является source of truth;
- как обрабатываются входящие и исходящие события;
- как ведутся retry, error handling и observability;
- как внешние интеграции вписываются в multi-tenant модель.

---

## 2. Ключевой принцип

DomHub не должен быть просто “тонкой прослойкой” между UI и внешней СКУД.

DomHub должен быть:
- самостоятельной operational platform;
- source of truth для внутренних workflows;
- координационным слоем над внешними systems of execution.

### Правило

Для resident/staff/requests/policies/incidents source of truth — **DomHub**.  
Для факта физического прохода external access systems могут быть execution systems, но эти события должны быть приведены в модель DomHub.

---

## 3. Классы интеграций

### 3.1 Access control integrations

Это основной класс:
- шлагбаумы;
- ворота;
- домофоны;
- калитки;
- двери;
- турникеты;
- контроллеры доступа;
- ANPR / номерные системы;
- считыватели QR / BLE / card / face.

### 3.2 Notification integrations

- SMS;
- push providers;
- Telegram;
- email, если появится.

### 3.3 Operational integrations

- ERP / 1С;
- billing systems;
- ticketing/support systems;
- export/import channels.

### 3.4 Platform integrations

- webhooks;
- partner systems;
- external analytics / BI endpoints, если будут разрешены.

---

## 4. Integration model per tenant

Все интеграции должны быть:
- property-scoped by default;
- configurable per property;
- observable per property;
- isolated from other tenants.

### Обязательные сущности

- `integrations`
- `integration_events`
- `provider_config`

### Запрещённый подход

Нельзя иметь скрытые “глобальные” интеграционные настройки, влияющие на все объекты, если это не platform-level shared infrastructure and is not explicitly modeled.

---

## 5. Provider adapter pattern

Каждая интеграция должна реализовываться через adapter abstraction.

### 5.1 Adapter responsibilities

Adapter должен:
- уметь принимать DomHub internal command;
- уметь преобразовывать его во внешний формат;
- уметь принимать external event;
- уметь преобразовывать внешний event во внутреннюю модель DomHub;
- отдавать нормализованные ошибки;
- не протекать vendor-specific logic в product domain.

### 5.2 Vendor-neutral internal model

Внутренняя модель должна быть стабильной даже если провайдеры меняются.

Пример:
- внутри DomHub есть `access_point`, `access_method`, `visit_log`;
- внешний провайдер может использовать собственные device IDs и event taxonomy;
- adapter обязан сделать mapping.

---

## 6. Направления обмена

### 6.1 Outbound flows

Из DomHub наружу:
- создание/обновление access rules in external system;
- временная активация доступа;
- revoke/block actions;
- webhook delivery;
- notification delivery requests.

### 6.2 Inbound flows

Из внешней системы в DomHub:
- access granted event;
- access denied event;
- gate/barrier status event;
- integration error event;
- inbound webhook payload;
- plate recognition result;
- external access attempt event.

---

## 7. Source of truth rules

### 7.1 DomHub-owned truth

Source of truth в DomHub:
- resident and staff identities in DomHub scope;
- access requests;
- approvals;
- policies;
- incidents;
- audit trail;
- management analytics.

### 7.2 External-system-owned truth

External systems may be source of truth only for:
- low-level device telemetry;
- raw controller/gate event;
- hardware health details.

Но даже в этом случае:
- события должны быть записаны и нормализованы в DomHub.

### 7.3 Conflict rule

Если событие из внешней системы противоречит состоянию DomHub:
- конфликт не должен silently затирать внутренние данные;
- должен создаваться `integration_event` and optionally `access_incident`;
- требуется conflict-resolution path.

---

## 8. Sync model

### 8.1 Push-based

Используется, когда провайдер поддерживает webhooks/events.

Плюсы:
- быстрее;
- ближе к near-real-time;
- меньше polling.

Минусы:
- нужно обрабатывать delivery reliability;
- нужен signature validation.

### 8.2 Pull-based

Используется, когда провайдер не умеет вебхуки или требует polling.

Плюсы:
- проще интегрироваться со старыми системами;
- контролируемый темп синхронизации.

Минусы:
- задержка;
- нагрузка;
- сложнее разбирать race conditions.

### 8.3 Hybrid

Допустим, если:
- push используется для событий,
- pull для reconciliation and backfill.

---

## 9. Retry and failure handling

### 9.1 Integration event statuses

Поддерживаются:
- `pending`
- `processing`
- `succeeded`
- `failed`
- `retrying`
- `dead_lettered`

### 9.2 Retry strategy

Retry должен быть:
- bounded;
- observable;
- idempotent where possible.

Примерная стратегия:
- immediate retry
- delayed retry
- exponential backoff or fixed-step backoff
- dead-letter after threshold

### 9.3 Dead-letter rules

Если событие не может быть обработано после допустимого числа попыток:
- оно помечается как `dead_lettered`;
- становится видимым в operational tooling;
- optionally creates incident or alert.

---

## 10. Idempotency rules

Для интеграций обязательно:
- external event IDs should be stored when available;
- repeated deliveries must not create duplicate core events;
- outbound commands should be idempotent where possible;
- retries should not multiply operational side effects.

---

## 11. Access integration specifics

### 11.1 Mapping model

DomHub должен уметь маппить:
- `access_zone` -> external area/group
- `access_point` -> external device/reader/controller
- `pass` -> external temporary credential
- `vehicle` -> external whitelist entry where supported

### 11.2 Minimum supported access scenarios

Интеграционный слой должен как минимум поддержать:
- QR-based guest access
- vehicle allowlist sync
- manual security decision logging
- inbound allow/deny events

### 11.3 Advanced scenarios

На более позднем этапе:
- BLE/mobile credentials
- card sync
- face enrollment hooks
- ANPR feeds

### 11.4 DH-41 SKUD framework baseline

The first production-facing SKUD framework slice is vendor-neutral and uses:
- `skud_provider_configs` for per-property provider configuration, sync mode, capabilities, health and credential reference metadata;
- `skud_hardware_devices` for mapping provider devices to DomHub `access_points`, including `source_of_truth` and `fallback_rule` for every configured hardware class;
- `skud_integration_events` for inbound/outbound event logs with status, retry/dead-letter fields, normalized payloads and idempotency by `(property_id, provider_config_id, external_event_id)`;
- adapter registry under `backend/src/services/skud` so vendor-specific adapters can be plugged in without changing access-domain models.

Vendor-specific end-to-end integrations remain `DH-42+`.

### 11.5 DH-42 vendor wave 1 baseline

The first vendor wave exercises Hikvision- and Bolid/Orion-compatible flows through the neutral framework:
- `POST /api/v1/skud/providers/:providerConfigId/events` accepts inbound provider access events with `X-SKUD-Secret` / `X-Integration-Secret`, normalizes the vendor payload, resolves mapped hardware device/access point, writes `skud_integration_events`, and appends `visit_logs_v2` with `event_source='skud'`;
- `POST /api/v1/skud/providers/:providerConfigId/sync-pass` lets a scoped property admin provision or revoke a pass through the configured provider adapter and records the outbound command in `skud_integration_events`;
- `HikvisionAdapter.normalizeInboundEvent()` maps common Hikvision event payload fields into DomHub `entry_allowed`, `entry_denied`, `exit_allowed`, or `exit_denied` events;
- `BolidAdapter` implements the Orion Pro integration-module JSON-RPC baseline with configurable method names, Basic Auth/token params, visit provisioning/revocation, service health and Orion-style event normalization;
- repeated provider event IDs are idempotent and do not create duplicate visit logs.

This baseline is enough to exercise a first-wave provider path without claiming full vendor coverage. Deeper device quirks, reconciliation and production rollout are follow-up work.

---

## 12. Notification integration specifics

### Requirements

- property-level provider settings
- delivery result tracking
- retry on transient failure
- hard failure marking
- per-channel health visibility

### Channels

- SMS
- Push
- Telegram
- future: email

---

## 13. Webhook architecture

### Outbound webhooks

Use cases:
- access granted
- access denied
- incident created
- request resolved
- package picked up

### Requirements

- HMAC signature
- delivery logs
- retry policy
- status visibility
- dead-letter handling

### Baseline outbound payload contract

Every outbound webhook delivery MUST include:
- JSON payload field `version` with current value `v1`;
- JSON payload fields `event`, `eventId`, `deliveryId`, `correlationId`, `attempt`, `timestamp`, and `data`;
- `eventId` and `deliveryId` set to the delivery/outbox row id, not the business correlation id;
- stable `deliveryId` across retries so receivers can deduplicate idempotently;
- headers `X-DomHub-Event`, `X-DomHub-Event-Version`, `X-DomHub-Event-Id`, `X-DomHub-Delivery`, `X-DomHub-Correlation-Id`, `X-DomHub-Attempt`, and `X-DomHub-Signature`.

### Inbound webhooks

Must support:
- signature/secret verification
- idempotency
- payload validation
- tenant resolution

---

## 14. Security requirements for integrations

Must include:
- secrets isolation per tenant
- no plain-text secret exposure in logs
- signature verification for inbound traffic where supported
- audit for integration config changes
- least-privilege access to provider credentials

---

## 15. Observability requirements

For every integration, DomHub should be able to show:
- status
- last success
- last error
- last attempt
- pending/retrying/dead-lettered counts
- property scope
- provider scope

Operationally useful visibility is mandatory.

---

## 16. Testing requirements for integrations

Must cover:
- adapter unit tests
- payload mapping tests
- retry logic tests
- idempotency tests
- bad signature tests
- tenant resolution tests
- dead-letter tests

---

## 17. Release rules for integrations

Integrations must not be rolled out:
- without property scoping;
- without observability;
- without retry behavior;
- without failure handling;
- without at least one smoke-test scenario in staging.

---

## 18. Next related documents

Integration architecture depends on:
- `domhub-access-data-model-spec.md`
- `domhub-access-policy-spec.md`
- `domhub-test-strategy-spec.md`
- `domhub-deployment-and-tenant-ops-spec.md`

The next useful adjacent document is:
- `domhub-analytics-metric-definitions.md`

