# Rezidence4 — конкретный backlog функциональных пробелов

**Дата:** 28 октября 2026  
**Ветка:** `codex/mobile-app-foundation`  
**Связанные документы:** [матрица функций](./REZIDENCE4_FEATURE_MATRIX_2026-10-28.md), [технический план](./REZIDENCE4_TECHNICAL_REBUILD_PLAN_2026-10-28.md), [инженерные стандарты](./REZIDENCE4_ENGINEERING_STANDARDS_2026_2027.md)

## Как читать этот backlog

Это backlog реализации и проверки, составленный по статическому просмотру кода и существующих спецификаций. Он не означает, что все перечисленные функции отсутствуют. Статусы означают:
- **Довести** — код/контракт найден, но путь надо проверить и закрыть разрывы.
- **Сверить модель** — документация и фактическая модель расходятся или существуют legacy- и v1-пути.
- **Подтвердить тестом** — по коду нельзя честно заявить runtime-готовность.
- **Решение продукта** — сначала выбрать целевое поведение, не создавать новый модуль вслепую.

Не выполнять миграции с удалением данных, не подключать реальные устройства и не деплоить на production в рамках этих задач. Использовать синтетические данные и отдельные тестовые базы.

## P0 — блокеры надёжного MVP

### GAP-01. Воспроизводимый запуск проекта с нуля

- **Статус:** подтвердить тестом.
- **Что сделать:** выровнять инструкции, Docker Compose service names, переменные окружения, миграции Registry/property DB и seed-данные. Сделать seed идемпотентным и синтетическим.
- **Где смотреть:** `README.md`, `docker-compose.yml` (проверить фактическое имя файла/варианта в репозитории), `.env.example`, `backend/src/platformMigrations.js`, `backend/src/dbMigrations.js`, `backend/src/v1/migrations/`, корневой и backend `package.json`.
- **API/экран:** health/readiness endpoints, диагностические сообщения запуска; отдельного пользовательского экрана не требуется.
- **Тесты:** добавить/уточнить CI job, который на чистом окружении устанавливает зависимости, поднимает БД и Redis, применяет миграции, создаёт тестовый tenant и проверяет readiness. Найти и согласовать существующие smoke/migration tests, не плодить параллельный harness.
- **Проверка:** новый checkout + только описанные в документации команды приводят к рабочему окружению без ручного редактирования файлов.
- **Готово, когда:** чистый прогон проходит в CI дважды; повторный seed не дублирует записи; README совпадает с Compose и реальными scripts.

### GAP-02. Канонический жизненный цикл заявки и пропуска

- **Статус:** сверить модель — обнаружено расхождение между целевой v1-спекой и legacy-моделью.
- **Что сделать:** выбрать source of truth: `access_requests` → approvals → pass → QR/token → visit decision → revoke/expiry. Убрать двусмысленность, где заявка, QR и пропуск — одна сущность в разных местах. До миграции явно задокументировать совместимость legacy API.
- **Где смотреть:** `backend/src/v1/routes/accessRequests.js`, `backend/src/v1/routes/passes.js`, `backend/src/v1/routes/visits.js`, `backend/src/routes/requests.js`, `backend/src/routes/publicPass.js`, `backend/src/routes/guardScan.js`, `backend/src/app/registerApiRoutes.js`, `RECONCILIATION.md`, `docs/product/specs/platform-v1/access-requests-spec.md`, `backend/src/v1/migrations/009_access_requests.sql`, `backend/src/v1/migrations/010_access_approvals.js`.
- **API:** целевые v1 endpoints по access-requests, passes, guard scan/visits; точные методы и mount paths зафиксировать по router definitions и OpenAPI перед реализацией.
- **Экраны:** resident access/pass screens; `frontend/src/views/guard/GuardScannerView.tsx`.
- **Тесты:** сквозной E2E: жильцовый пользователь создаёт заявку → approval (если требуется) → активный QR → охрана сканирует → создаётся visit/audit record → отзыв → повторная проверка запрещает вход. Проверить действующий `test:e2e:v1-access` и расширить его, а не дублировать.
- **Проверка:** один сценарий проходит на свежей тестовой БД и изолированном tenant; legacy-путь либо покрыт contract tests, либо явно deprecated.
- **Готово, когда:** состояния и переходы описаны таблицей; запрещённые переходы возвращают стабильный код ошибки; один и тот же бизнес-факт не хранится в противоречивых источниках.

### GAP-03. Проверка пропуска при ошибках, повторе и гонках

- **Статус:** довести и подтвердить тестом.
- **Что сделать:** проверить атомарность «проверить токен → зафиксировать решение/использование», повторный QR, одновременное сканирование на двух постах, истечение срока, revoke/block, malformed/unknown token и сетевой таймаут. Не допускать разрешения при неопределённом результате.
- **Где смотреть:** `backend/src/v1/routes/visits.js`, `backend/src/v1/routes/passes.js`, `backend/src/routes/guardScan.js`, `frontend/src/shared/api/guardScanApi.ts`, `frontend/src/views/guard/GuardScannerView.tsx`, `frontend/src/hooks/useOnlineStatus` (проверить точный путь).
- **API/экран:** `POST /api/v1/guard/scan-pass` упоминается в коде клиента/экрана; сверить точный mount path в `registerApiRoutes.js` и OpenAPI.
- **Тесты:** unit/integration tests на все состояния; параллельные запросы; DB rollback/timeout; Playwright E2E для allow/deny/error. При offline UI только сообщает «не удалось проверить», не даёт разрешение.
- **Проверка:** повторный или конкурентный запрос не создаёт противоречивые решения; недоступность БД/Redis приводит к fail-closed и понятному сообщению.
- **Готово, когда:** ни один сценарий сбоя не превращается в allow; решение и причина отражены в журнале.

### GAP-04. Tenant isolation и fail-closed на каждом критическом endpoint

- **Статус:** критическая проверка, несмотря на существующий middleware.
- **Что сделать:** проверить, что каждый property-scoped route использует tenant DB/context, а legacy fallback `req.db || db` не позволяет случайно обслужить запрос через общую БД. Для v1 при отсутствии/неизвестном/неактивном tenant — отказ, не fallback.
- **Где смотреть:** `backend/src/middleware/propertyDb.js`, `backend/src/app/registerApiRoutes.js`, `backend/src/routes/auth.js`, `backend/src/v1/routes/notificationLog.js`, все `backend/src/v1/routes/*.js`.
- **API:** все tenant-scoped API; начать с auth, residents/units, access requests, passes, visits, incidents, documents/uploads, notifications.
- **Тесты:** tenant A не читает/изменяет/удаляет данные tenant B; spoofed `X-Property-Slug`; конфликт hostname и JWT claim; отсутствующий/неизвестный/неактивный tenant; проверка прямого доступа к объектам по чужому ID.
- **Проверка:** негативные тесты проверяют и status code, и отсутствие побочных изменений/утечек в теле ответа.
- **Готово, когда:** весь критический endpoint inventory имеет tenant-isolation test; неизвестный tenant не переключает маршрут на global DB.

### GAP-05. Полная матрица RBAC и ресурсных прав

- **Статус:** довести и подтвердить тестом.
- **Что сделать:** описать таблицу «роль × действие × ресурс × tenant/zone scope» для resident, guard/staff, property admin, platform admin и подрядчика. Не полагаться на скрытие кнопок на клиенте.
- **Где смотреть:** `backend/src/middleware/auth.js`, `backend/src/middleware/`, `backend/src/v1/routes/`, `frontend/src/domain/permissions` (проверить точное имя файла), `frontend/src/views/guard/GuardScannerView.tsx`.
- **API/экраны:** все критические v1 endpoints; resident dashboard, guard console, admin views.
- **Тесты:** parameterized role matrix для read/create/update/delete/approve/revoke/export; resident не читает чужие заявки и документы; guard не управляет tenant; property admin не получает platform-wide доступ; UI guard/ resident проверяется на прямой URL и API.
- **Проверка:** каждое правило backend-авторизации покрыто тестом на разрешённый и запрещённый путь.
- **Готово, когда:** у каждой роли есть утверждённые разрешения и тесты; клиентские проверки — только UX, не граница безопасности.

### GAP-06. Единый аудит решений и действий

- **Статус:** довести модель.
- **Что сделать:** единообразно записывать actor, role, tenant, action, resource, timestamp, correlation/request ID, reason, outcome. Отдельно фиксировать manual override и административные изменения. Не писать OTP, токены и лишние персональные данные.
- **Где смотреть:** `backend/src/v1/routes/visits.js`, `backend/src/v1/routes/accessIncidents.js`, `backend/src/v1/migrations/010_access_approvals.js`, `RECONCILIATION.md`, существующие audit/logger modules.
- **API/экраны:** журнал посещений, инциденты и admin audit view; если отдельного audit API нет — описать контракт и добавить только после проверки существующих.
- **Тесты:** allow, deny, revoke, override, approval/rejection, admin mutation; запрет изменения чужим tenant; секреты/PII отсутствуют в логах.
- **Проверка:** бизнес-действие и его audit record фиксируются согласованно; повтор запроса не создаёт ложные дубли.
- **Готово, когда:** все security-critical действия имеют структурированную аудиторскую запись и покрыты интеграционными тестами.

### GAP-07. Настоящий канал уведомлений и наблюдаемость доставки

- **Статус:** частично; текущий STUB-режим требует явного release gate.
- **Что сделать:** согласовать канонический notification dispatcher/outbox, статусы queued/sent/failed/retry, дедупликацию, backoff и безопасное сообщение пользователю при неудачной доставке. Production конфигурация не должна принимать `SMSRU_API_ID=STUB`.
- **Где смотреть:** `.env.example`, `backend/src/app/registerApiRoutes.js`, найденные notification/outbox/dispatcher/channel modules; точные пути определить по поиску символов перед изменением.
- **API/экраны:** notification log/preferences; UI не должен показывать «отправлено», если провайдер вернул ошибку.
- **Тесты:** STUB в production config fails startup/CI; provider timeout, retry, duplicate event, exhausted retries, invalid credentials; секреты в логах замаскированы.
- **Проверка:** тестовый провайдер получает ожидаемое сообщение один раз с идемпотентным event ID; ошибка видна администратору.
- **Готово, когда:** доставка наблюдаема end-to-end, а тестовый режим невозможно незаметно принять за production.

## P1 — завершение рабочих процессов

### GAP-08. Отделить заявки на доступ от сервисных заявок УК

- **Статус:** сверить модель; legacy `requests` смешивает access и service.
- **Что сделать:** завершить канонические контракты `/api/v1/access-requests` и `/api/v1/service-requests`; определить переходный adapter для старых `/api/v1/requests` и `/api/*`; нормализовать статусы и историю approvals. Не переносить данные до тестов миграции.
- **Где смотреть:** `backend/src/routes/requests.js`, `backend/src/v1/routes/accessRequests.js`, `backend/src/v1/migrations/009_access_requests.sql`, `backend/src/v1/migrations/010_access_approvals.js`, `docs/product/specs/platform-v1/access-requests-spec.md`, `RECONCILIATION.md`.
- **Экраны:** resident requests/access screens; admin approval queue; service-request UI.
- **Тесты:** contract tests для legacy и v1; таблица соответствия старых статусов; migration dry-run на копии синтетической БД; невозможные статусы отклоняются.
- **Проверка:** новый UX не пишет в legacy монолит напрямую; старые клиенты получают документированный совместимый ответ до снятия alias.
- **Готово, когда:** определён migration/compatibility plan и все статусные переходы имеют contract tests.

### GAP-09. Политики доступа, зоны и точки прохода как конфигурируемые правила

- **Статус:** есть топология/спеки; сквозное enforcement нужно доказать.
- **Что сделать:** реализовать или завершить policy evaluation для subject, access method, zone/point, schedule, approval mode и направления прохода. Валидировать, что zone/point принадлежат тому же tenant и активны. Решение должно вычисляться сервером, а не только UI.
- **Где смотреть:** `backend/src/v1/routes/visits.js`, `backend/src/v1/routes/accessRequests.js`, `backend/src/v1/routes/passes.js`, `docs/product/specs/domhub-access-policy-spec.md`, `docs/product/specs/platform-v1/access-topology-spec.md`.
- **API/экраны:** admin topology/policy screens; guard station/checkpoint selector; verify/scan endpoint.
- **Тесты:** расписание до/после окна; запрещённая зона; неактивная точка; точка из другого tenant; contractor-only zone; entry/exit direction; ручное исключение с reason + audit.
- **Проверка:** одинаковый набор входных условий даёт детерминированное серверное решение с кодом причины.
- **Готово, когда:** правила редактируются администратором в рамках прав и одинаково применяются ко всем каналам проверки.

### GAP-10. Полноценный журнал смены и передача дежурства

- **Статус:** workflow не подтверждён как завершённый.
- **Что сделать:** формализовать начало/конец смены, сотрудника и пост, незакрытые инциденты, важные события, список временных пропусков/исключений, комментарий передающего и подтверждение принимающего.
- **Где смотреть:** существующие guard/security workspace modules, visit logs, access incidents; сначала найти их реальные пути поиском `shift`, `handoff`, `incident`, `guard` в backend/frontend.
- **API/экраны:** guard dashboard, shift handoff view, incident list/detail. Если endpoint отсутствует, сначала согласовать data model/API contract.
- **Тесты:** передача смены с незакрытым инцидентом; смена другого tenant; повторная отправка handoff; время/таймзона; аудит правок после подтверждения.
- **Проверка:** новая смена видит контекст, но не может незаметно переписать уже подтверждённую передачу.
- **Готово, когда:** смена закрывается воспроизводимо, а незавершённые события не теряются.

### GAP-11. Единая очередь инцидентов и ручных исключений

- **Статус:** endpoints/modules существуют, UX и правила закрытия нужно подтвердить.
- **Что сделать:** унифицировать incident lifecycle: открыть, назначить, эскалировать, добавить evidence, разрешить override при наличии права, закрыть с причиной. Отдельно отличать инцидент от отказа в доступе.
- **Где смотреть:** `backend/src/v1/routes/accessIncidents.js`, `backend/src/v1/routes/visits.js`, `frontend/src/views/guard/GuardScannerView.tsx` и соответствующие admin/guard views (точные пути инвентаризировать).
- **API/экраны:** incident queue/detail, recent access events, manual decision form.
- **Тесты:** override без роли запрещён; причина обязательна; запись неизменяема для обычной роли; cross-tenant ID; attachment authorization; событие закрытия попадает в audit.
- **Проверка:** каждое исключение имеет автора, причину, время и итоговое решение.
- **Готово, когда:** нет бесследных ручных разрешений и потерянных инцидентов.

### GAP-12. Мобильное приложение жильца — рабочий MVP вместо shell

- **Статус:** не считать готовым к пилоту без сборки и E2E.
- **Что сделать:** выбрать и зафиксировать поддерживаемый Expo SDK, добавить lockfile и CI; подключить native auth/session secure storage; реализовать список/создание/отзыв пропусков, QR, заявки и уведомления. Убрать placeholder buttons и не маскировать неподдерживаемые действия.
- **Где смотреть:** `apps/mobile/` (точный состав проверить по tree), mobile `package.json`, корневые workspaces/scripts, `frontend/src/shared/api/guardScanApi.ts` только как веб-референс API-контракта.
- **API:** использовать канонические v1 contracts, не добавлять отдельную бизнес-логику только для мобильного клиента.
- **Экраны:** auth, home, access requests, pass details/QR, notifications, profile/session state.
- **Тесты:** typecheck/lint/unit; Android build; iOS build в доступной CI-среде; тест на реальном Android-устройстве; refresh/logout/expired session; отсутствие сети; API contract tests.
- **Проверка:** пользователь может пройти ключевой сценарий без webview и без заглушек.
- **Готово, когда:** чистая сборка воспроизводима, ключевые экраны подключены к API, тесты и проверка устройства пройдены. Не обещать push до проверки credentials и платформенных настроек.

### GAP-13. Полноценный admin UX для структуры ЖК и пользователей

- **Статус:** backend modules существуют; сквозная полнота UI не подтверждена.
- **Что сделать:** закончить управление корпусами/подъездами/квартирами, жильцами, staff/contractors, зонами/точками и назначениями; добавить импорт с preview/валидацией/отчётом ошибок, деактивацию с проверкой зависимостей и аудит.
- **Где смотреть:** `backend/src/v1/routes/structure.js`, `backend/src/v1/routes/memberships.js`, другие `backend/src/v1/routes/*.js`, `frontend/src/v1/api/types.ts`, соответствующие admin screens.
- **API/экраны:** structure/users/memberships endpoints и admin pages; точные screen paths составить по router registry.
- **Тесты:** unit/entrance/building consistency; нельзя деактивировать unit с active residents; import duplicates/invalid rows/partial failure; role and tenant isolation.
- **Проверка:** администратор выполняет типовой onboarding тестового ЖК без SQL вручную.
- **Готово, когда:** создание/изменение/архивация доступны через UI и имеют ошибки/аудит/тесты.

### GAP-14. Документы и вложения: права, lifecycle и приватность

- **Статус:** модули найдены; полный security path не подтверждён.
- **Что сделать:** проверить MIME/content sniffing, лимиты размера, имена файлов, malware scanning strategy, private storage, short-lived download authorization, удаление и retention. Запретить угадываемые публичные ссылки на приватные документы.
- **Где смотреть:** `backend/src/routes/upload.js`, документы/attachments routes и services, `backend/src/v1/routes/`, privacy modules.
- **API/экраны:** upload/download endpoints, resident documents, admin evidence attachments.
- **Тесты:** чужой tenant/user; spoofed MIME; oversized file; path traversal; revoked authorization; expired URL; deleted file; PII/secrets in logs.
- **Проверка:** приватный файл нельзя получить только по ID/URL без авторизации и проверки scope.
- **Готово, когда:** security-negative suite проходит и политика хранения/удаления документирована.

## P2 — масштабирование после core MVP

### GAP-15. Реальные интеграции СКУД/видеонаблюдения с безопасной деградацией

- **Статус:** адаптеры/абстракции не считать доказательством работы с оборудованием.
- **Что сделать:** выбрать конкретную модель/протокол для пилота, сделать simulator contract, idempotent command IDs, timeout/retry, состояние оборудования и ручной fallback с аудитом.
- **Где смотреть:** integration/webhook modules, access topology, `docs/product/specs/platform-v1/access-topology-spec.md`, integration specs.
- **API/экраны:** integration health/status, checkpoint/device configuration, event reconciliation.
- **Тесты:** simulator contract; timeout; duplicate command; offline controller; stale event; credential rotation; replay.
- **Проверка:** стендовый прогон на выбранной модели оборудования, без заявления совместимости с неиспытанными моделями.
- **Готово, когда:** опубликован список испытанных моделей/версий и runbook восстановления.

### GAP-16. Операционная готовность: backup/restore, alerts, нагрузка

- **Статус:** scripts/основа найдены, успешное восстановление и текущий load baseline не подтверждены.
- **Что сделать:** автоматизировать restore drill в изолированную БД; определить SLO/health checks; алерты по ошибкам доступа, задержке API, failed notifications, pool exhaustion и сроку TLS; нагрузочный профиль по tenant и checkpoint.
- **Где смотреть:** backup scripts, workflow files, health/metrics/logging modules, `docker-compose.yml`, runbooks.
- **API/экраны:** внутренние health/metrics, ops dashboard при наличии.
- **Тесты:** restore + integrity checks; dependency failure; alert firing; load test с зафиксированными dataset/commit/metrics.
- **Проверка:** другой инженер выполняет восстановление по runbook; тест фиксирует время восстановления и потери данных.
- **Готово, когда:** есть датированный restore report, нагрузочный baseline и проверенные инструкции.

### GAP-17. Контрактная документация и снятие дублей API

- **Статус:** legacy/v1 пересечение.
- **Что сделать:** сопоставить route registry, OpenAPI и реальную маршрутизацию; указать canonical endpoint, owner, auth/role, tenant scope, request/response schema и deprecation date. Удалять aliases только после telemetry/compatibility review.
- **Где смотреть:** `backend/src/app/registerApiRoutes.js`, `docs/openapi.json`, `docs/api/README.md`, `backend/src/routes/`, `backend/src/v1/routes/`, frontend API clients.
- **API/экраны:** все существующие клиенты и integration tests.
- **Тесты:** OpenAPI lint; route inventory parity; schema contract tests; deprecated route behavior.
- **Проверка:** каждый публичный endpoint присутствует в реестре и документации либо явно помечен internal/deprecated.
- **Готово, когда:** нет неучтённых маршрутов и двусмысленного source of truth.

## Общие правила Definition of Done

Задача не закрывается только потому, что код написан. Для каждого GAP:
1. Изменение ограничено конкретным scope и не затрагивает production.
2. API contract и роли документированы.
3. Есть unit + integration/E2E тесты соответствующего уровня.
4. Есть позитивные и негативные сценарии, включая tenant isolation там, где применимо.
5. Миграции проверены на чистой и повторно инициализированной тестовой БД.
6. Typecheck/lint/build и целевые тесты проходят на зафиксированном commit SHA.
7. UX показывает loading/empty/error/permission-denied/offline states.
8. Логи не раскрывают токены/OTP и лишние персональные данные.
9. Документация и feature matrix обновлены.
10. Нет merge/deploy до отдельного явного разрешения владельца проекта.

## Рекомендуемый порядок выполнения

1. GAP-01: воспроизводимое окружение.
2. GAP-02 + GAP-03: канонический pass lifecycle и сквозные тесты.
3. GAP-04 + GAP-05: tenant isolation и RBAC.
4. GAP-06 + GAP-07: audit и delivery semantics.
5. GAP-08 + GAP-09: разделение заявок и policy engine.
6. GAP-10 + GAP-11: смены и инциденты.
7. GAP-13 + GAP-14: admin UX и документы.
8. GAP-12: мобильный MVP после фиксации API-контрактов.
9. GAP-15 + GAP-16 + GAP-17: интеграции, ops readiness и API cleanup.

**Важно:** если фактический код на целевой ветке отличается от файлов, найденных в статическом поиске, сначала обновить inventory и указать точный commit. Не считать названный тест успешным, пока его не запустили и не сохранили результат.
