# Rezidence4 — единый план работ до первого релиза

**Дата среза:** 28 октября 2026  
**Репозиторий:** `saschadudkin-sketch/rezidence4`  
**Рабочая ветка:** `codex/mobile-app-foundation`  
**PR:** [#154 — draft](https://github.com/saschadudkin-sketch/rezidence4/pull/154)  
**Текущий блокер:** [Issue #155 — воспроизводимая база разработки](https://github.com/saschadudkin-sketch/rezidence4/issues/155)

> Это единый источник порядка работ до первого пилотного релиза. Он объединяет технический план, feature matrix и функциональный gap backlog. Он не означает, что задачи уже выполнены или тесты прошли. Статус фиксируется только по проверяемым результатам на конкретном commit SHA.

## 1. Текущее состояние — без приукрашивания

- PR #154 открыт и остаётся **Draft**, base `main`, head `codex/mobile-app-foundation`.
- Ветка содержит аудит, roadmap, инженерные стандарты, feature matrix и gap backlog; последний проверенный head SHA на момент создания плана: `a3dd34ab9746faf6999adc203bba4bea29048b9a`.
- Для этого SHA GitHub connector не вернул CI statuses или workflow runs. Это **не означает ни успеха, ни ошибки CI** — актуальный runtime baseline ещё не подтверждён.
- Issue #155 открыт и содержит правильную первую задачу: воспроизводимое окружение и baseline.
- В `apps/mobile/package.json` найден Expo SDK 53 / React Native 0.79.2; в `apps/mobile/README.md` прямо указаны отсутствующие native auth/session, live passes, QR, push и verified builds. Mobile lockfile не найден в проверенном срезе.
- В `frontend/package.json` используется React 18, а в root manifest указан React 19. Нужно разрешить версионную политику, не обновляя всё одним рискованным коммитом.
- В `.github/workflows/ci.yml` backend/frontend CI настроены на Node 20, тогда как инженерный стандарт рассматривает Node 24 LTS. Сначала установить baseline, проверить совместимость и затем отдельным изменением выровнять toolchain.
- В репозитории уже есть release-gate scripts, включая `release:gate:matrix`, `release:gate:check`, `test:e2e:v1-access`, `verify:strict`, `pilot:readiness` и restore-drill tooling. Их надо использовать и проверить, а не создавать параллельную систему gates.
- Приложение не вводилось в эксплуатацию; реальные данные и production-секреты не нужны для разработки. Никакого server deployment на этапах 0–6.

## 2. Объём первого релиза (фиксируем границы)

### Входит в пилот
1. **Resident Web:** вход, данные своей квартиры/объекта в пределах прав, создать/посмотреть/отменить пропуск, безопасно показать/передать гостю QR.
2. **Guard Web, mobile-first:** QR-сканирование, ручной поиск по разрешённым атрибутам, серверное решение, история визитов, регистрация отказов и инцидентов.
3. **Admin Web:** жильцы/квартиры, роли/сотрудники, настройки пропусков и правил, аудит критических действий, состояние приложения и каналов уведомлений.
4. **Resident Mobile Android/iOS:** native auth/session, список и управление пропусками, QR, безопасная передача пропуска. Native guard app не входит в первый пилот; используется Guard Web.
5. **Обязательные основы:** tenant isolation, RBAC, audit, migrations, CI, backup/restore drill, logs/alerts, runbooks, privacy/security review.

### Не блокировать первый релиз необязательными модулями
- Реальная СКУД/видеонаблюдение до получения конкретной модели/протокола и тестового стенда.
- Offline-allow; при потере связи решение «не удалось проверить», а не разрешение.
- Push до стабилизации основного сценария. Для пилота выбрать проверенный канал доставки пропуска и ясно показывать неудачную доставку.
- Чаты, бронирования, биллинг/счётчики, расширенная аналитика и прочие legacy/adjacent modules — только отдельным продуктовым решением, если они действительно нужны для пилота.

## 3. Единый план задач по этапам

Каждая задача закрывается вместе с тестами и доказательством. Задача с кодом, но без выполненной проверки, остаётся «реализована, не подтверждена».

### Этап 0 — инвентаризация и воспроизводимость (первый блокер)

- [ ] **R0.1 — Зафиксировать baseline и точный scope.** Снять head/base SHA, проверить изменённые файлы, актуальные package manifests, lockfiles, CI workflow и имеющиеся release-gate scripts. Не считать прошлые результаты актуальными для нового SHA.
  - Файлы: `package.json`, `backend/package.json`, `frontend/package.json`, `apps/mobile/package.json`, `.github/workflows/ci.yml`, `scripts/release-gate-matrix.cjs`.
  - Проверка: записать версии runtime, команды, exit codes, длительность и артефакты каждого запуска.
  - Готово: baseline-отчёт прикреплён к PR; известные падения имеют лог и owner/следующий шаг.

- [ ] **R0.2 — Выровнять clean setup.** Сверить README, `docker-compose.yml`, `.env.example`, имена сервисов, имена БД, healthchecks и migration entrypoints. Проверить Registry DB и property DB отдельно.
  - Файлы: `README.md`, `docker-compose.yml`, `ops/db-init/`, `backend/src/platformMigrations.js`, `backend/src/dbMigrations.js`, `backend/src/v1/migrations/`, `backend/package.json`.
  - Проверка: чистый запуск из нового checkout, миграции на пустой PostgreSQL, повторный запуск.
  - Готово: инструкция работает без ручного исправления конфигов; повторные миграции/seed безопасны.

- [ ] **R0.3 — Синтетический seed и test fixtures.** Подготовить 2 tenant-а, квартиры, жильцов, guard, property admin, platform admin и тестовые пропуска; никаких реальных телефонов/данных.
  - Файлы: существующие seed/test fixtures, миграции и E2E setup; найти их прежде чем добавлять новый harness.
  - Проверка: seed идемпотентен и используется в backend integration + E2E.
  - Готово: тесты воспроизводимы и cross-tenant тесты используют минимум два объекта.

- [ ] **R0.4 — Зелёный backend/web baseline.** Запустить существующие backend tests, critical coverage, contract tests, open-handles, frontend lint/tests/typecheck/build, Playwright preflight и критический E2E. Зафиксировать фактические команды из package scripts.
  - Команды-кандидаты: `npm run backend:test`, `npm run frontend:lint`, `npm run typecheck`, `npm run frontend:test`, `npm run frontend:build`, `npm run test:e2e:v1-access`, `npm run verify:strict`.
  - Готово: required jobs зелёные либо каждый remaining blocker имеет issue, лог и принятое решение. Не объявлять зелёным то, что не запускалось.

- [ ] **R0.5 — Согласовать toolchain.** Сначала проверить фактическую совместимость текущего CI Node 20; затем отдельным PR выбрать и закрепить поддерживаемую Node LTS версию в CI/Docker/local docs. Разобраться с root React 19 vs frontend React 18. Не менять package manager, Node, React, Vite и mobile SDK одним коммитом.
  - Файлы: `.github/workflows/ci.yml`, `Dockerfile*`, `.nvmrc`/toolchain config если есть, все manifests/lockfiles.
  - Готово: clean install и CI совпадают по версиям; выбранные обновления имеют зелёные тесты.

**Gate 0:** clean install, миграции, synthetic seed и повторяемые backend/web проверки работают; baseline документирован. Issue #155 закрывать только по этим критериям.

### Этап 1 — backend security и tenant boundaries

- [ ] **R1.1 — Инвентаризация endpoint-ов.** Для каждого критического маршрута записать method/path, router mount, middleware, роль, tenant source, DB accessor, DTO/OpenAPI и тест.
  - Файлы: `backend/src/app/registerApiRoutes.js`, `backend/src/middleware/propertyDb.js`, `backend/src/v1/routes/*.js`, `backend/src/routes/*.js`, `docs/openapi.json`.
  - Готово: все auth, residents/units, access-requests, passes, visits, incidents, documents и notifications endpoints учтены; v1/legacy/platform границы понятны.

- [ ] **R1.2 — Fail-closed tenant DB access.** Проверить все tenant-scoped handlers; убрать риск неявного перехода на глобальную БД через legacy fallback. Неизвестный/неактивный/отсутствующий tenant должен получать отказ.
  - Файлы: `backend/src/middleware/propertyDb.js`, `backend/src/app/registerApiRoutes.js`, все критические `backend/src/v1/routes/*.js`, legacy routes с `req.db || db`.
  - Тесты: spoofed `X-Property-Slug`, hostname/JWT mismatch, no tenant, unknown/inactive tenant, IDOR и побочные эффекты.
  - Готово: негативные проверки на двух tenant-ах доказывают отсутствие чтения/записи чужих данных.

- [ ] **R1.3 — RBAC и resource scopes.** Утвердить матрицу ролей resident, guard/staff, property admin, platform admin, contractor × действия × ресурсы × tenant/zone.
  - Файлы: backend auth/permission middleware и `frontend/src/domain/permissions` (точный путь подтвердить), все критические routers.
  - Тесты: разрешённый/запрещённый запрос каждой роли; direct API call независимо от скрытия кнопок.
  - Готово: каждый критический endpoint имеет permission test и отрицательный тест.

- [ ] **R1.4 — Сессии и auth.** Проверить OTP, лимиты, повторное использование, refresh rotation/replay, logout/revoke, expiry, CSRF/Origin и деактивацию аккаунта.
  - Файлы: auth/session services, middleware и соответствующие backend tests; пути определить из endpoint inventory.
  - Готово: integration suite подтверждает отзыв/истечение и не раскрывает наличие аккаунта/секреты.

- [ ] **R1.5 — Production config gates и безопасные логи.** Отвергать SMS STUB и небезопасные обязательные настройки в production; маскировать OTP, session/QR tokens и PII.
  - Файлы: `.env.example`, env validation, notification config, logger/redaction tests.
  - Готово: negative config tests завершаются ошибкой запуска/релизной проверки; секреты отсутствуют в логах.

**Gate 1:** cross-tenant access и RBAC закрыты негативными тестами; сессии и production configuration не имеют известных критических блокеров.

### Этап 2 — один канонический access/pass contract

- [ ] **R2.1 — Утвердить state machine и source of truth.** Связать access request → approval (если требуется) → pass → credential/QR → visit decision → revoke/expiry. Разделить access и service requests, определить compatibility/deprecation для legacy `/api/*`.
  - Файлы: `backend/src/v1/routes/accessRequests.js`, `backend/src/v1/routes/passes.js`, `backend/src/v1/routes/visits.js`, `backend/src/routes/requests.js`, `backend/src/routes/publicPass.js`, `backend/src/routes/guardScan.js`, `backend/src/app/registerApiRoutes.js`, `RECONCILIATION.md`, `docs/product/specs/platform-v1/access-requests-spec.md`, migrations 009/010.
  - Готово: canonical endpoints, enum states, transition rules и deprecation policy записаны; legacy aliases покрыты contract tests.

- [ ] **R2.2 — Серверная проверка QR/кода.** Проверять статус, временное окно, tenant, scope, checkpoint/zone policy, revoke, повторное предъявление и полномочия оператора. QR — непрозрачный токен без PII.
  - Файлы: `backend/src/v1/routes/visits.js`, `backend/src/v1/routes/passes.js`, `frontend/src/shared/api/guardScanApi.ts`.
  - Endpoint, упомянутый в Guard UI: `POST /api/v1/guard/scan-pass`; подтвердить фактический mount path в route registry и OpenAPI.
  - Тесты: valid, future, expired, revoked, malformed, unknown, used/replayed, wrong tenant/zone, unauthorized operator.

- [ ] **R2.3 — Атомарность, гонки и fail-closed.** Проверить повторные и параллельные scan-запросы, таймаут БД/Redis и ошибки внешних зависимостей.
  - UI: `frontend/src/views/guard/GuardScannerView.tsx`.
  - Готово: сбой/неопределённость никогда не возвращает allow; параллельные проверки дают согласованный результат и не дублируют бизнес-события.

- [ ] **R2.4 — Audit trail.** Единая запись actor/role/tenant/action/resource/time/request ID/reason/outcome для создания, передачи, отмены, scan allow/deny, approval и manual override.
  - Файлы: visits/incidents routes, audit/logger modules, миграции по итогам reconciliation.
  - Готово: действия и audit events согласованы транзакционно там, где требуется; секреты не логируются.

- [ ] **R2.5 — End-to-end access proof.** Использовать существующий `npm run test:e2e:v1-access` и сценарии `e2e/v1-access-production.spec.js`, `e2e/pass-flow.spec.js`, не создавая дубликаты.
  - Flow: resident creates request → approval if required → QR/pass shown → guard server scan → visit/audit event → revoke → subsequent scan denied.
  - Готово: проходит на чистой тестовой БД; artifact привязан к commit SHA.

**Gate 2:** один полный путь «заявка → QR → решение охраны → журнал → отзыв» доказан E2E; все негативные состояния закрыты.

### Этап 3 — завершить Web MVP

- [ ] **R3.1 — Resident Web.** Подключить канонические API для квартиры/профиля, списка, создания, отмены и безопасной передачи пропуска. Не дублировать бизнес-правила в UI.
  - Найти актуальные resident/access/pass pages через frontend router; API clients сверить с OpenAPI.
  - Тесты: loading/empty/error/401/403/429/5xx, чужой pass ID, revoke, refresh/session expiry.
  - Готово: сценарий работает с backend, а не demo/mock provider.

- [ ] **R3.2 — Guard Web.** Довести QR scan, ручной поиск, reason-coded allow/deny/error, visit log и retry безопасной операции.
  - Файлы: `frontend/src/views/guard/GuardScannerView.tsx`, `frontend/src/shared/api/guardScanApi.ts`, `backend/src/v1/routes/visits.js`.
  - Тесты: scanner permission denied/camera unavailable/manual fallback, server unavailable, invalid/expired/revoked, repeated scan, unauthorized role.
  - Готово: mobile-first UI подходит планшету поста; UI не подменяет server verdict и не показывает allow при сетевой ошибке.

- [ ] **R3.3 — Admin Web.** Управление тестовым ЖК, жильцами/квартирами, staff roles и access policy в пределах permissions; аудит действий.
  - Файлы: соответствующие `backend/src/v1/routes/*`, `frontend/src/v1/api/types.ts`, admin screens, router registry.
  - Тесты: onboarding synthetic tenant без ручного SQL, validation, duplicate import, permissions, audit.
  - Готово: ключевые настройки пилота выполняются через UI и не требуют прямой правки БД.

- [ ] **R3.4 — UX/accessibility и контрактное соответствие.** У всех критических экранов есть loading/empty/error/offline/permission states; API contracts валидируются и отражены в OpenAPI.
  - Проверки: frontend lint, typecheck, unit tests, production build, Playwright role/navigation/access E2E, accessibility smoke.
  - Готово: обязательные checks зелёные и ошибки понятны сотруднику поста/жильцу.

**Gate 3:** web E2E покрывает жильца, охрану и администратора на реальном backend; no demo mode для release сценариев.

### Этап 4 — Resident Mobile Android/iOS

- [ ] **R4.1 — Согласовать SDK и воспроизводимые зависимости.** Сейчас найден Expo SDK 53/RN 0.79.2; выбрать поддерживаемую стабильную SDK-линию по compatibility check. Не принимать SDK 58 или другую версию только потому, что она указана как кандидат в стандарте.
  - Файлы: `apps/mobile/package.json`, `apps/mobile/app.json`/app config, `apps/mobile/README.md`, корневые workspaces/scripts.
  - Готово: Expo doctor/install check проходит; lockfile создан и коммитнут; зависимости устанавливаются через clean install.

- [ ] **R4.2 — Native auth/session.** Реализовать отдельный native auth contract, короткоживущий access token, rotation/revoke refresh, secure storage ОС, logout и expiry.
  - Файлы: `apps/mobile/src/**` (точную структуру проверить), backend auth/session routes/services.
  - Запрет: не хранить токены в AsyncStorage, URLs, logs или public app config.
  - Тесты: OTP, refresh race, replay, logout, revoked session, expired session, no network.

- [ ] **R4.3 — Реальные resident flows.** Реализовать профиль/квартиру, list/create/cancel/share pass, QR display и server-backed status. Удалить placeholder actions или явно пометить недоступные функции.
  - API: canonical v1 contracts из этапа 2; не делать отдельный mobile-only business API без ADR.
  - Готово: нет заглушек в ключевом сценарии, данные ограничены серверными правами, QR не содержит PII.

- [ ] **R4.4 — Mobile CI и device validation.** Добавить typecheck/lint/unit tests и Android/iOS development builds в доступных CI runners; проверить реальное Android-устройство и iOS device/simulator.
  - Проверить deep links, плохую сеть, смену/истечение сессии, экранные размеры и безопасную обработку ошибок.
  - Готово: сборки воспроизводимы, ключевой сценарий пройден на обеих платформах или iOS limitation явно принята до пилота.

**Gate 4:** resident может выполнить основной сценарий в Android и iOS; auth и pass flow протестированы; lockfile/build evidence доступны.

### Этап 5 — дополнительные функции, нужные пилоту

- [ ] **R5.1 — Service requests/maintenance workflow** только если УК включает это в пилот: create → assign → status → comments/evidence → close; отделить от access request.
- [ ] **R5.2 — Shift handoff/incident workflow**: смена, пост, открытые инциденты, подтверждение передачи, назначение/эскалация/закрытие с audit.
- [ ] **R5.3 — Documents/uploads**: private storage, scoped authorization, content/MIME/size validation, retention/deletion, cross-tenant negative tests.
- [ ] **R5.4 — Notification delivery**: выбрать и реально проверить один необходимый канал; queued/sent/failed/retry, idempotency, delivery log; STUB запрещён в production.
- [ ] **R5.5 — Policy engine/topology**: если зоны/checkpoints обязательны для пилота, подтвердить server-side rules for schedule, zone, active checkpoint, role and reasoned override.
- [ ] **R5.6 — Реальные СКУД/video integrations** только при наличии выбранной модели, спецификации и test bench; иначе явно исключить из пилота.
- **Готово:** только выбранные для пилота дополнительные процессы закрыты тестами; остальное остаётся documented post-MVP backlog, а не полусделанным релизным блокером.

### Этап 6 — release readiness без production deployment

- [ ] **R6.1 — Полный CI на одном commit.** Backend tests + critical coverage + contracts + open handles; frontend lint/tests/typecheck/build/bundle budget; E2E access/role matrix; mobile typecheck/build; security/dependency/secret checks.
- [ ] **R6.2 — Выполнить существующую release gate matrix.** Сначала `npm run release:gate:matrix` и `npm run release:gate:metadata`, затем подходящие `npm run release:gate:check`, `npm run verify:strict`, `npm run pilot:readiness` и `npm run pilot:release-packet`. Сначала проверить required environment и не запускать destructive tenant/provision/restore commands на непредназначенной среде.
- [ ] **R6.3 — Backup/restore drill.** Выполнить в изолированной тестовой среде, проверить целостность и зафиксировать RPO/RTO; сохранить evidence/report.
- [ ] **R6.4 — Failure and load tests.** PostgreSQL/Redis unavailable, slow provider, rate limits, concurrency on scans, pool exhaustion, representative login/list/create/verify load.
- [ ] **R6.5 — Security/privacy/legal review.** Threat model, tenant/IDOR/RBAC review, upload/auth/CSRF/Origin, secret scan, log redaction, Russian personal-data requirements and retention/deletion review before real data.
- [ ] **R6.6 — Operations pack.** Runbooks for DB/Redis/SMS failure, guard network loss, revoke session/pass, incident escalation; monitoring/alerts, TLS expiry, owner/on-call and rollback procedure.
- [ ] **R6.7 — Pilot acceptance.** Checklist signed by product owner + operator; test users/devices, test scenarios, known limitations, support contact, go/no-go record.
- **Готово:** release packet contains CI artifacts, E2E report, mobile build evidence, restore report, security review, runbooks and accepted limitations; no P0 open.

**Gate 6:** release readiness approved. Это разрешение готовить staging/pilot deployment, не автоматическое разрешение на production deployment.

### Этап 7 — staging, pilot, production release

- [ ] **R7.1 — Staging only after Gate 6.** Отдельные секреты, домен/TLS, backup, monitoring, synthetic data, no production resident records.
- [ ] **R7.2 — Pilot rehearsal.** Проверить onboarding одного тестового ЖК, роли, жильцов, проходы, отмены, смену охраны, сбой сети, restore/rollback.
- [ ] **R7.3 — Ограниченный пилот.** Только после явного разрешения владельца проекта; критерии остановки и rollback заранее определены.
- [ ] **R7.4 — Production go/no-go.** Отдельное решение после результатов пилота, legal/privacy review, мониторинга и подтверждённого восстановления.
- [ ] **R7.5 — Release tag and support.** Подписанный/идентифицируемый release commit, release notes, версия mobile, поддерживаемые миграции и процедура инцидента.
- **Готово:** production не включается автоматически после зелёного CI; требуется отдельное явное подтверждение владельца.

## 4. Общие Definition of Done

Для каждой задачи:
1. Изменение ограничено scope и привязано к commit SHA.
2. Существующие модули/тесты исследованы до добавления дубликата.
3. API contract, role, tenant scope и ошибки задокументированы.
4. Есть позитивные и негативные unit/integration/E2E проверки на подходящем уровне.
5. Все relevant tests реально запущены; результат не выводится из наличия файла.
6. Нет secrets, production URLs и настоящих персональных данных.
7. UX показывает loading/empty/error/permission denied/offline states.
8. Логи не раскрывают OTP, tokens, QR credential и избыточную PII.
9. Документация и feature matrix обновлены.
10. CI evidence относится к текущему commit SHA.
11. Нет merge/deploy без отдельного явного разрешения.

## 5. Как вести задачи без дублирования

- Этот документ — **единый порядок и release gates**.
- `REZIDENCE4_FEATURE_MATRIX_2026-10-28.md` — инвентарь функций/статусов.
- `REZIDENCE4_FUNCTIONAL_GAP_BACKLOG_2026-10-28.md` — подробные GAP-01…GAP-17 с файлами и критериями.
- `REZIDENCE4_TECHNICAL_REBUILD_PLAN_2026-10-28.md` — архитектурные решения и подробности реализации.
- `REZIDENCE4_ENGINEERING_STANDARDS_2026_2027.md` — целевые технические стандарты и compatibility gates.
- Issue #155 — текущий исполнительный тикет для Этапа 0. Следующие issue/PR создаются по этапам, не одним огромным PR.
- PR #154 остаётся Draft до review scope, clean baseline и проверки CI; не считать его релизным PR.

## 6. Следующее действие прямо сейчас

Начать только с Этапа 0:
1. Проверить точный head SHA и чистоту diff.
2. Сверить README/Compose/env/migrations/scripts.
3. Выполнить clean install и синтетический запуск.
4. Запустить имеющиеся backend/web checks и сохранить логи.
5. Исправить только блокеры baseline отдельными небольшими коммитами.
6. Зафиксировать Expo SDK/lockfile/mobile checks после выбора совместимой версии.
7. Обновить Issue #155 критериями и закрыть его только после Gate 0.

**Не начинать одновременно новые продуктовые модули, обновление всего стека и интеграцию с реальной СКУД. Не разворачивать сервер и не добавлять production secrets/real data до прохождения Gate 6 и отдельного разрешения владельца проекта.**
