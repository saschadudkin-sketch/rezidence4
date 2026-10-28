# Rezidence4 — матрица функциональной готовности

**Дата:** 28 октября 2026  
**Репозиторий:** saschadudkin-sketch/rezidence4  
**Ветка анализа:** codex/mobile-app-foundation  
**Основа:** статический аудит исходников, конфигурации, документации и наличия тестов.

> Важно: найденный код или тестовый файл не доказывает, что функция работает в реальной среде. Полный набор тестов, clean install, миграции, Android/iOS builds, backup restore и проверки оборудования в рамках этого аудита не запускались. «Не подтверждено» не означает автоматически «не реализовано».

## Легенда

- **Есть в коде** — соответствующий модуль найден, но runtime-поведение ещё нужно подтвердить.
- **Частично** — базовая реализация есть, но отсутствует часть потока, интеграции или доказательств.
- **Не подтверждено / не обнаружено** — готовая реализация или успешное испытание не найдены в проверенном срезе.
- **Legacy / пересечение** — несколько маршрутов или слоёв реализуют похожую ответственность и требуют явных границ.

## 1. Функции продукта

| Домен / функция | Следы в репозитории | Статус | Что нужно проверить | Приоритет |
|---|---|---|---|---|
| OTP-вход жильца | backend auth routes, auth/session services и тесты | Есть в коде; runtime не подтверждён | Верный/неверный/истёкший код, повторное использование, лимиты отправки/попыток, неизвестный номер не раскрывается | P0 |
| Web-сессия, refresh, logout | session service, auth middleware, refresh/revocation tests | Есть в коде; нужен интеграционный прогон | Ротация refresh, replay старого токена, logout/revoke, expiry, деактивация пользователя, гонки refresh | P0 |
| Нативная авторизация Android/iOS | apps/mobile shell и API helper | Не завершена | Контракт native auth, secure storage ОС, refresh/revoke/logout, истёкшая сессия; не хранить секреты в AsyncStorage | P0 |
| Жители и квартиры | /api/v1/residents, /api/v1/units, lifecycle/offboarding modules | Частично / core-pilot | Привязка пользователя к квартире, совместное проживание, смена жильца, импорт, offboarding, отсутствие доступа к чужой квартире | P0 |
| Заявки на доступ | /api/v1/access-requests и legacy requests/service | Есть в коде; параллельные контуры | Создание, валидация, разрешённые статусы, отмена, идемпотентность, проверка прав на каждом действии | P0 |
| Создание гостевого пропуска | /api/v1/passes, public pass, frontend pass UI | Есть в коде; end-to-end не подтверждён | Создание, срок действия, tenant/unit scope, список/детали, отмена, ошибки и повторная отправка | P0 |
| QR-код | Frontend QR modal и backend pass/verify modules | Частично / требует сквозной проверки | Непредсказуемый токен, серверная проверка, отзыв/expiry, отсутствие секрета QR в логах | P0 |
| Проверка QR охраной | /api/v1/verify, guard scan, v1 verification services/tests | Есть базовая реализация; безопасность решения не подтверждена | Valid/expired/revoked/unknown, чужой tenant/зона, неправильное время, replay, timeout и недоступность сервера | P0 |
| Ручной поиск посетителя | verify/guard scan, plate normalization | Есть в коде; полнота не подтверждена | Поиск, неоднозначные совпадения, минимизация раскрываемых ПДн, права оператора, аудит решения | P0 |
| Отзыв и истечение пропуска | pass service/lifecycle tests | Есть базовые механизмы; нужен E2E | После отзыва повторная проверка запрещена; границы времени/timezone; server clock; истечение | P0 |
| Допуск персонала/подрядчиков | staff, technician, contractor workspaces | Core/pilot | Согласование, сроки, зоны, ответственный, завершение работ, запрет просроченного доступа | P1 |
| Автомобили и госномера | /api/v1/vehicles, normalization/tests | Есть базовая реализация | Форматы номеров, дубликаты, права на авто, связка с пропуском, ложные совпадения | P1 |
| Доверенные посетители и blacklist | trusted visitor/blacklist modules/tests | Есть отдельные модули; бизнес-правила сверить | Конфликт блокировки с активным пропуском, право добавить/снять, причина и аудит | P1 |
| Рабочее место охраны | /api/v1/security/*, visit logs, guard scan | Backend есть; готовность интерфейса не подтверждена | Реальный телефон/планшет, быстрый поиск, явные состояния отказа/ошибки, сеть пропала, смена поста | P0 |
| Журнал посещений | visit logs and visit services/tests | Есть в коде | Actor, tenant, checkpoint, timestamp, outcome, reason; фильтры/пагинация; нельзя подменить событие клиентом | P0 |
| Журнал происшествий | access incidents/service/routes/tests | Есть в коде; workflow проверить | Создание/изменение/закрытие, автор, время, история, вложения, права, поиск и отчёт | P1 |
| Приём/сдача смены охраны | security/operations workspace; полный workflow не подтверждён | Не подтверждено как завершённая функция | Передача поста, сотрудники, замечания, незавершённые события и подтверждение передачи | P1 |
| Админ-панель ЖК | users/perms/settings/residents/units/topology modules | Много модулей; полнота не подтверждена | CRUD, опасные действия, блокировка аккаунта, отзыв сессий, RBAC, audit trail | P1 |
| Superadmin и портфель ЖК | backend/src/routes/platform/*, portfolio endpoints/tests | Есть в коде; tenant isolation тестировать | Создание/приостановка/завершение объекта, только platform-admin, DSN rotation, поведение suspended tenant | P1 |
| Зоны, точки доступа и политики | access-zones, access-points, access-policies services/tests | Есть в коде; интеграционное поведение проверить | Deny-by-default, приоритет правил, расписание, зона, тип посетителя, выключенная точка, причина решения | P0 |
| Объявления и рассылки | announcements endpoints/services/tests, notification modules | Есть в коде; доставка не подтверждена | Публикация/снятие, аудитории, retry, ошибки провайдера, защита от массовой отправки | P2 |
| Обращения жителей в УК | request services, categories, status transitions, SLA | Развитая база; возможен параллельный workflow | Создание, назначение, SLA, комментарии, вложения, уведомления, закрытие/переоткрытие | P1 |
| Документы и загрузки | documents endpoints/services, upload security/access tests | Есть в коде; доступ проверить | MIME/size, signed URL expiry, чужой tenant, удаление/retention, доступ по угадываемому ID | P1 |
| Чат | chat backend/frontend tests | Legacy/gated; не считать MVP без проверки | Нужен ли в MVP; доступ к комнатам/сообщениям, удаление, уведомления, вложения | P2 |
| Бронирования, помещения, счётчики, биллинг | billing/bookings/meter-readings/spaces | Legacy/gated; готовность не доказана | Утвердить продуктовую необходимость; если оставить — тесты расчётов, конфликтующих броней, округлений и доступа | P2 |
| Push | push subscriptions, dispatcher/channels/tests | Серверная основа есть; реальная доставка не подтверждена | Доставка на устройства, invalid token cleanup, retry/backoff, настройки и отзыв подписки | P1 |
| SMS | smsService.js; .env.example содержит SMSRU_API_ID=STUB | Частично; STUB пропускает отправку | Production обязан отвергать STUB; staging delivery, таймауты/retry, лимиты, маскирование данных | P0 |
| Telegram и webhooks | telegram bot, webhook service/routes/tests | Интеграционная основа есть; production не подтверждён | Подпись, SSRF/URL validation, replay/idempotency, retries, dead-letter, secrets redaction | P2 |
| СКУД | Bolid/Hikvision/template adapters and tests | Адаптеры есть; совместимость с реальным оборудованием не подтверждена | Точные модели/протокол, тестовый контур, связь пропала, идемпотентность команд, аудит ручного override | P1 |
| Камеры / видео evidence | video provider adapters, evidence route/service/tests | Абстракции есть; реальный провайдер не подтверждён | Конкретный DVR/NVR, права, retention, целостность evidence, защита от открытых URL | P2 |
| GIS/OSS и отраслевые контуры | GIS/OSS readiness modules | Pilot/readiness, не доказанная интеграция | Внешний контракт, тестовая среда, владелец интеграции | P2 |

## 2. Безопасность и права

| Контроль | Статус по исходникам | Обязательные проверки | Приоритет |
|---|---|---|---|
| RBAC / permissions | Middleware, routes и RBAC tests есть; сквозная матрица не подтверждена | Роль × endpoint × действие; прямой API-вызов в обход UI; deny-by-default | P0 |
| Изоляция разных ЖК | Tenant resolver/property DB архитектура есть; negative-test gate не подтверждён | Tenant A не читает/меняет tenant B; подмена hostname/header/claim; tenant отсутствует/неизвестен/неактивен | P0 |
| Изоляция квартир и ресурсов | Resource scope/lifecycle modules есть; runtime не подтверждён | Житель A не читает/отменяет пропуск B; сотрудник ограничен объектом и зоной | P0 |
| Legacy DB fallback | В legacy auth обнаружен паттерн req.db || db | Проверить все tenant-scoped routes: отсутствующий tenant должен давать отказ, не переход на глобальную БД | P0 |
| CSRF/CORS/Origin | Защитные middleware и tests есть | Cross-origin mutation, отсутствующий/неверный Origin, корректность web cookie flow | P0 |
| OTP rate limit | CSPRNG/hash/expiry/лимиты описаны; тесты есть | Параллельные запросы, Redis outage, reuse, одинаковые внешние ответы, срок блокировки | P0 |
| Refresh replay/revoke | Базовая реализация и тесты есть | Повтор старого refresh, logout, отзыв устройства, expiry и деактивация пользователя | P0 |
| Idempotency | Middleware/tests есть | Повтор запроса после timeout, duplicate pass/request, одинаковый key с разным payload | P1 |
| Upload security | Security/access tests есть | Content-Type spoof, traversal, cross-tenant, expired signed URL, size limit, retention | P1 |
| Audit | Audit/review services/tests есть; покрытие всех критичных действий не подтверждено | Actor/tenant/target/outcome/timestamp для каждого опасного изменения; секреты не попадают в логи | P1 |
| Биометрия | README помечает методы как dormant | Не включать в MVP; проверить, что feature flag/endpoint не активирует неготовый поток | P2 |
| Персональные данные | Privacy/readiness docs и сервисы есть; юридическое соответствие не подтверждено | Retention, экспорт/удаление, доступ персонала, локализация, договоры и процесс инцидентов; отдельная юридическая оценка | P1 |
| Секреты и окружения | Env examples/security scripts есть; production evidence отсутствует | Secret scan, запрет default/stub, ротация, разделение окружений, redaction логов | P0 |

## 3. API, база данных и архитектура

| Область | Наблюдение и статус | Что проверить / решение | Приоритет |
|---|---|---|---|
| API v1 | Заявлен как основной контракт; есть routes/tests | Контрактные тесты критических endpoint, схемы ошибок, auth scopes, pagination | P0 |
| Legacy /api aliases | Есть compatibility routes параллельно v1 | Allowlist legacy, сравнение auth/validation, метрики использования; удалять после проверки клиентов | P1 |
| OpenAPI | В docs/openapi.json заявлены 306 paths и 160 schemas; контракты неполны | Request/response/error schemas, security requirements, generated types, drift checks | P0 |
| Registry DB + property DB | Модель и resolver есть | Чистые миграции, timeout/DB outage, tenant suspend/terminate, смена DSN | P0 |
| Pool lifecycle | Pool на tenant хранится в Map; до 20 соединений на pool по аудиту | Глобальный connection budget, закрытие/eviction, много tenant-ов, удалённая/недоступная БД | P1 |
| Миграции | Скрипты и тесты найдены; clean DB run не подтверждён | Registry + tenant DB с нуля, повторный запуск, порядок, rollback/recovery | P0 |
| Redis | Используется для revocation/rate limits и вспомогательных задач | Redis down/restart; не обходятся ли защитные лимиты при отказе | P0 |
| Outbox/workers | Dispatcher, outbox, scheduled jobs и тесты присутствуют | Duplicate delivery, retries, dead-letter, порядок, restart worker, idempotency | P1 |
| Логи/метрики | Logger, metrics, client logs, Sentry scrubbing tests есть | Correlation ID, отсутствие OTP/token/QR, алерты, health/readiness | P1 |
| Зависимости | Root/backend/frontend manifests; root React 19, frontend React 18 | Уточнить install/workspace policy, lockfiles, npm ci; root по возможности оставить tooling-only | P1 |
| Лицензия | В аудите LICENSE в корне не найден, package указывает ISC | Добавить корректную LICENSE/NOTICE либо определить политику публичности | P2 |

## 4. Клиенты и UX

| Клиент | Статус | Что проверить |
|---|---|---|
| Web жильца | Развитая база; сквозная готовность не подтверждена | OTP → квартира → пропуск → QR → отзыв; loading/empty/error/forbidden/session-expired; production build |
| Web охраны | Backend есть; готовность UI не подтверждена | Телефон/планшет, камера и ручной поиск, явное решение, network failure, смена поста |
| Web администратора | Много модулей; полнота UI/API не подтверждена | CRUD, опасные действия, RBAC, tenant isolation, audit, empty/error states |
| Native resident app | Prototype, не готов к пилоту | Expo SDK 53/RN 0.79, нет mobile lockfile/CI job, кнопки-заглушки; выбрать SDK, lockfile, Expo Doctor, typecheck, сборки и устройства |
| Native guard app | Не подтверждена в текущем MVP | Не создавать параллельно без доказанной необходимости; сначала довести Guard Web |
| Accessibility/responsive | Есть тестовые файлы/проверки отдельных компонентов; полное покрытие неизвестно | Keyboard/focus, screen reader labels, contrast, text scaling, узкий экран, реальные Android устройства |
| Offline | README упоминает offline replay security workspace; безопасное поведение не подтверждено | Никакого offline allow; тесты replay, timestamp, idempotency, конфликтов и явного статуса «не удалось проверить» |

## 5. CI, запуск и эксплуатация

| Область | Статус | Следующий шаг | Приоритет |
|---|---|---|---|
| Docker Compose | Конфигурация есть, README quickstart расходится с Compose | README указывает postgres-registry/postgres-object-demo; compose определяет db/redis/backend/frontend/backup. Проверить clean start | P0 |
| CI | Workflows есть, актуальный зелёный baseline не подтверждён | В аудите последний найденный main run от 24 июля 2026 был частично красным; повторить на текущем commit | P0 |
| Backend tests | Много тестов, suite не запускался в рамках аудита | npm ci, test:ci, critical coverage, contract tests, open handles | P0 |
| Frontend tests/build | Тесты есть; свежий результат неизвестен | lint, typecheck, unit, production build, Playwright E2E | P0 |
| E2E | Есть login/pass/navigation/role/mobile/operations specs; наличие не равно успешному прогону | Запустить на чистом окружении, сохранить отчёт и traces при падении | P0 |
| Mobile CI/build | Полноценный job и lockfile отсутствуют | Зафиксировать SDK/lockfile, Expo Doctor, typecheck/tests, Android+iOS builds | P0 |
| Backup | Scripts/readiness tests есть; restore не подтверждён | Backup → restore в изолированную БД → целостность данных и время восстановления | P0 |
| TLS | Production overlay зависит от host certs/cron | Мониторинг срока сертификата, renew/reload drill, runbook | P1 |
| SMS/push/СКУД | Адаптеры есть; реальные credentials/оборудование не проверены | Staging delivery и hardware tests | P0/P1 |
| Нагрузочное тестирование | Метрики/скрипты есть; актуального отчёта нет | Определить SLO и проверить OTP, scans, API latency, pool saturation, recovery | P1 |
| Runbooks/инциденты | Документация есть частично; готовность процессов не подтверждена | Сценарии DB/Redis/SMS/СКУД outage, утечка токена, потеря backup, ошибочный допуск | P1 |
| Deployment | Production compose/docs есть; реальный сервер не развёрнут/не подтверждён | Staging, secrets, migrations, TLS, health checks, rollback, smoke; production отдельно | P0 |
| Юридическая готовность | Privacy/Russia readiness документы обозначены как specs/drafts | Отдельная оценка обработки ПДн, локализации, retention, договоров и прав субъектов | P1 |

## 6. Дублирование и пересечения

Не удалять модули автоматически. Сначала сравнить поведение, тесты и потребителей; затем выбрать канонический путь.

| Пересечение | Риск | Рекомендация |
|---|---|---|
| v1 API и legacy /api | Разные проверки прав, валидация и ошибки | Новые клиенты — только v1; учесть legacy usage и удалить compatibility позже |
| Access requests и legacy requests | Дублирующиеся статусы/сервисы могут разойтись | Один доменный state machine/DTO; legacy adapter либо явно заморожен |
| passes/publicPass/verify/guardScan/visitLogs | Один бизнес-процесс разбит на разные маршруты | Единый Pass/Verification service; routes — только HTTP-адаптеры |
| auth/platformAuth/propertyDb/legacy DB fallback | Неясные границы platform и tenant auth | Развести platform identity и tenant identity; tenant-scoped accessor fail-closed |
| Root/backend/frontend package manifests | Неочевидные runtime/tooling границы; React 19 vs React 18 | Уточнить install policy; не менять package manager одновременно с рефакторингом |
| Notification service/channels/dispatcher/outbox/SMS/push/Telegram | Повторная логика retries, логирования и конфигурации | Общий Notification contract и channel adapters, единые retries/idempotency/observability |
| Staff/technician/contractor/security workspaces | Повторные очереди, статусы и проверки ролей | Общие primitives и authz; доменные правила оставить явными |
| Analytics/operations dashboard/portfolio/readiness | Пересекающиеся агрегаты и KPI | Для каждой метрики определить source of truth, период, timezone и владельца |
| Feature flags/readiness/release gates | Разные определения «готово» | Единая release-gate matrix; статический флаг не равен runtime evidence |
| README и Compose | Команды запуска не соответствуют сервисам | Одна каноническая инструкция, запускаемая в CI smoke job |

## 7. Обязательные тесты

### P0 — блокируют пилот

1. Чистая установка, Compose up, healthchecks, миграции Registry и tenant DB, synthetic seed, повторный запуск.
2. OTP/session → create pass → QR → server verify allow → visit/audit event → revoke → verify deny.
3. Состояния пропуска: not-yet-valid, valid, expired, revoked, malformed, unknown, replayed.
4. Tenant isolation: tenant A не читает/создаёт/изменяет/отменяет ресурсы tenant B; подмена header/hostname/claim; tenant missing/unknown/inactive.
5. Матрица resident/guard/property admin/platform admin на каждый критический endpoint.
6. Network/DB/Redis failure не превращается в разрешение прохода; UI различает «отказано» и «не удалось проверить».
7. OTP brute-force/reuse, refresh replay, logout/revoke, expiry, CSRF и Origin mismatch.
8. Production config отвергает SMS STUB; ошибка доставки не выглядит успешной отправкой.
9. Backup restore в изолированную БД с проверкой целостности ключевых таблиц и связей.
10. Свежий зелёный CI на конкретном commit: backend, web, contract, E2E и security scan.

### P1 — надёжность и расширение

11. Идемпотентность после timeout и повторной отправки заявки/пропуска.
12. Согласованность state transitions для access request/pass/incident/work order.
13. Upload authorization, signed URL expiry, retention/deletion и cross-tenant file access.
14. Outbox retry, duplicate delivery, dead-letter, worker restart и replay ordering.
15. Connection pool при большом числе tenant-ов и недоступной БД.
16. Реальные push/SMS/Telegram/webhook в staging.
17. СКУД/камеры на точном тестовом оборудовании.
18. Android/iOS builds, secure storage, session expiry, push, accessibility и device tests.
19. TLS renewal, monitoring alerts, backup retention и incident runbooks.
20. Нагрузочный тест по согласованным SLO.

## 8. Правило окончательного статуса

Считать функцию **подтверждённой** только когда есть: код и конкретный endpoint/UI; определённые роли и tenant/resource scope; request/response contract; автоматический happy-path и negative tests; свежий успешный CI на фиксированном commit; для внешней интеграции — подтверждённая работа в staging/на тестовом устройстве.

До этого использовать честные статусы: **есть в коде**, **частично**, **не обнаружено**, **не проверено**.

## 9. Очерёдность работ

1. P0: воспроизводимый dev setup и свежий CI baseline.
2. P0: сквозной resident → pass → guard verification → revoke.
3. P0: tenant isolation, RBAC и session negative tests.
4. P1: OpenAPI contracts и границы legacy/v1.
5. P1: SMS/push staging, backup restore, monitoring.
6. P1: завершить native resident app и Android/iOS validation.
7. P2: решить судьбу gated/legacy модулей.
8. Только после release gates — staging/pilot; production deploy отдельным решением.

**Ограничение:** это матрица по статическому анализу на указанную дату. Она не утверждает, что тесты успешно запускались, не заменяет аудит каждого endpoint и не подтверждает юридическое соответствие или сертификат безопасности.
