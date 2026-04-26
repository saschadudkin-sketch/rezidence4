# DomHub — Product Backlog (P0–P4)

**Ветка:** живёт на `platform-v1` и дальше
**Источник:** синтез из `RECONCILIATION.md` + `ROADMAP.md` + оценки продукта от 2026-04-22
**Связь с ROADMAP:** `ROADMAP.md` покрывает только P0-блок D-lite (Фазы 1–7). Всё P1+ — этот файл.

**Правила работы с бэклогом:**
1. Каждый пункт имеет приоритет `P0/P1/P2/P3/P4` и **не меняет его без записи причины** в разделе "Changelog" внизу.
2. Пункт переходит в `ROADMAP.md` (фазу-в-работе) только когда на него выделены ресурсы и срок.
3. Новые идеи попадают в `P4 — Parking lot` по умолчанию; подъём приоритета требует обоснования.
4. Удалять пункты нельзя — только перенести в `## Done` или `## Rejected` с датой и причиной.

---

## Легенда приоритетов

| P | Значение | Когда делать |
|---|---|---|
| **P0** | Критично до go-live Замоскворечья | Прямо сейчас, в рамках 10-недельного D-lite |
| **P1** | Критично для перехода к коммерческим продажам | Сразу после go-live, недели 11–16 |
| **P2** | Отличает «работает» от «премиум» | Второй квартал, недели 17–26 |
| **P3** | Масштабирование и защита рынка | Полгода-год, недели 27–52 |
| **P4** | Parking lot: думать, но не делать сейчас | Пересмотр каждые 3 месяца |

---

## 🔴 P0 — До go-live Замоскворечья (недели 1–10)

Пункты этого блока дублируют `ROADMAP.md` для единой картинки.

| # | Задача | Срок | Статус | Почему P0 |
|---|---|---|---|---|
| P0-1 | D-lite рефактор (Фазы 1–7) | 10 нед | **DONE (код)** — все 7 фаз закрыты, Phase 5/6/7 в PR #124 (2026-04-24). Остаётся execution runbook на VPS. | Pre-deployment окно — разовое |
| P0-2 | Outbox pattern для notifications | 1 нед | **DONE** — PR #124: `notificationOutbox.js` + 4 workers + миграция v1_016 | Inline-send ломает заявки при падении канала |
| P0-3 | Onboarding wizard для property-admin | 1 нед | **PARTIAL** — admin SPA готов; для одного объекта (Замоскворечье) seed через SQL в `go-live-zamoskv-runbook.md §3`; полный wizard для самостоятельного onboarding'а УК — после второго tenant'а | Без него подключение объекта = 2 дня ручной работы |
| P0-4 | Observability per-tenant (Grafana) | 4 дня | TODO (Sentry + Prometheus metrics есть; дашбордов нет) | С go-live слепые проблемы = видимые резидентам |
| P0-5 | Runbook + incident-процесс | 2 дня | **PARTIAL** — `go-live-zamoskv-runbook.md` есть; нужен зонтичный `docs/runbooks/README.md` (DOCS-5) | Нет описания on-call / SLA / эскалации |

---

## 🟠 P1 — После go-live, до коммерческих продаж (недели 11–16)

| # | Задача | Срок | Статус | Описание |
|---|---|---|---|---|
| P1-1 | Event sourcing для access-lifecycle | 3 нед | TODO | Append-only `access_events` + проекции. Разблокирует СКУД/видео/1С интеграции. |
| P1-2 | Policy engine — базовая версия | 2 нед | TODO | JSON-expressions: `subject_type + time_window → action`. Без него каждое правило = код. |
| P1-3 | Семейные аккаунты (households) | 1.5 нед | TODO | `households` + `residents.household_role`. Топ-запрос премиум-сегмента: муж+жена+дети, co-approval, ограничения для детей. |
| P1-4 | Self-serve trial для УК | 2 нед | TODO | Регистрация на domhub.su → auto-provision demo-tenant → конверсия. Без этого sales = только звонки. |
| P1-5 | Comprehensive E2E для access | 1 нед | TODO | Полные флоу: resident → approver → guest QR → guard scan → history. С разными ролями. |

---

## 🟡 P2 — Премиум-позиционирование (недели 17–26)

| # | Задача | Срок | Зависимости | Описание |
|---|---|---|---|---|
| P2-1 | Native mobile app (iOS + Android) | 6–8 нед | — | React Native/Flutter. Резидент + guard. Staff остаётся web. Без native premium-позиционирование невозможно. |
| P2-2 | Soft access (BLE) для резидентов | 3–4 нед | P2-1 (требует native) + BLE-СКУД | Проход без QR, телефон в кармане. Сильный signal. |
| P2-3 | Видео-идентификация гостей | 4 нед | Видеосистема с API (Trassir/Axxon/Ivideon) | Сравнение фото из заявки vs живой кадр. Убирает «передал QR постороннему». |
| P2-4 | Biometric/facial access | 4 нед + юр. | Оборудование + согласие ФЗ-152 + 572-ФЗ | Опционально; можно отложить до запроса клиента. |
| P2-5 | Data warehouse + analytics | 3 нед | — | ClickHouse/Metabase. Дневные snapshot → готовые дашборды для УК (тренды визитов, топ-проблем). |
| P2-6 | White-label для крупных УК | 1.5 нед | — | Custom domain + branding на management_company level. Отдельный тариф. |

---

## 🟢 P3 — Масштабирование и защита рынка (недели 27–52)

| # | Задача | Срок | Блокер старта | Описание |
|---|---|---|---|---|
| P3-1 | Partner marketplace | 6 нед | ≥20 tenants (two-sided market) | Курьеры, клининги, flower — с автодоступом. Комиссии = доп. revenue stream. |
| P3-2 | Интеграция с застройщиками | 3 нед | ≥5 реф-объектов | API + sales-материалы. Застройщик сдаёт → УК уже на DomHub. Канал без прямых продаж. |
| P3-3 | Smart home lite (умные замки) | 4 нед | — | Aqara, Yandex Home. Временный доступ и в квартиру. Нишевая, но покупает продукт за неё. |
| P3-4 | AI-консьерж | 4–6 нед | ≥1000 заявок per tenant (для fine-tune/RAG) | OpenAI/YandexGPT. Резидент в свободной форме → бот создаёт заявку. |
| P3-5 | Репутация подрядчиков | 2 нед | Накопленные данные | Рейтинг после заявки → auto-recommend. Data asset и moat. |
| P3-6 | DomHub Academy | 2+ нед, ongoing | ≥10 УК | Обучающие видео по ролям. Снижает support-нагрузку. |

---

## 🔵 P4 — Parking lot (далёкий горизонт)

Пункты для пересмотра каждые 3 месяца. Сейчас не делаем, но в голове держим.

| # | Идея | Почему отложено |
|---|---|---|
| P4-1 | ЕБС-интеграция (Единая биометрическая система) | Регуляторный оверхед, нишевый запрос |
| P4-2 | Парковочный менеджмент (dynamic spot allocation) | Требует hardware; спец. сегмент |
| P4-3 | ГИС ЖКХ интеграция | Только для регулируемых УК, не премиум |
| P4-4 | Страховые партнёрства | Нужен крупный финансовый партнёр |
| P4-5 | CRE-модуль (коммерческие помещения в ЖК) | Отдельный domain, другая монетизация |
| P4-6 | Голосование собственников (ТСЖ/ЖСК) | Юр. сложность, низкий ARPU прирост |
| P4-7 | Коммунальные интеграции (ресурсоснабжающие орг.) | Масштабный проект, стоит только после 50+ tenants |

---

## Архитектурные улучшения (cross-cutting, не привязаны к фазам)

Идеи, которые стоит держать в голове при проектировании любого нового модуля:

| # | Идея | Приоритет | Описание |
|---|---|---|---|
| ARCH-1 | GraphQL/tRPC для staff workspace | P2 | Много compound-view (резидент + пассы + авто + заявки + счётчики). REST требует много roundtrips. |
| ARCH-2 | CQRS-lite для read-heavy views | P2 | Guard console / дашборды — materialized views или Redis-проекции. |
| ARCH-3 | Тестовая sandbox в коде | P1 | `POST /api/v1/test/seed` создаёт property с mock-данными. Нужно для demo и onboarding. |
| ARCH-4 | Миграционная инфраструктура top-notch | P1 | Per-property DB означает: 1 новая колонка = N миграций. Нужен Liquibase/Flyway уровня или собственный runner с retry/rollback. |
| ARCH-5 | Feature flags — полная замена на GrowthBook/Unleash | P2 | Сейчас через `properties.feature_flags JSONB`. Работает, но нет UI, нет % rollouts, нет A/B. |
| ARCH-6 | API versioning policy | P1 | Сейчас `/api/v1` — de facto единственная версия. Нужна политика deprecation для будущих breaking changes. |
| ARCH-7 | Multi-region deploy (Timeweb + зеркало) | P3 | Disaster recovery. Сейчас один VPS = SPOF. |
| ARCH-8 | Убрать inline `style={{…}}` из legacy product UI в пользу CSS-классов/токенов | P2 | На 2026-04-23 в `frontend/eslint.config.js` отключено правило `no-restricted-syntax` для `admin/pages/{AuditLogPage,DashboardPage,ManagementCompanyDetailPage,PropertyDetailPage}.tsx` и `components/ConsentModal.tsx`. Новые inline-стили туда добавлять нельзя; цель — вынести существующие в utility-классы или css vars. Не блокер, но лишает lint-сигнала по этим файлам. Пересечение с BRAND-3 (см. ниже). |

---

## 📚 Документы и артефакты (gap-list от 2026-04-23)

Выделено отдельным блоком, потому что это не фичи продукта, а недостающая инженерная / продуктовая документация. Часть пунктов дублирует `docs/product/specs/domhub-missing-docs-priority.md` (от 2026-04-21, 5 из 14 ещё открыты); часть — найдена при сквозном аудите 2026-04-23 по `docs/`, корневым MD, `.github/`, `ops/`.

Префиксы: `DOCS-*` — спеки/документы, `BRAND-*` — дизайн/логотип, `OPS-*` — операционные runbook-и, `ENT-*` — OSS/enterprise гигиена.

### DOCS — продуктовые и инженерные спеки

| # | Документ | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| DOCS-1 | `docs/product/specs/platform-v1/notifications-outbox-spec.md` | P0 | Фаза 5, P0-2 | Спека outbox + retry/DLQ + абстрактного channel-adapter. Без неё Фазу 5 начинать нельзя по правилу «каждая фаза = своя спека». |
| DOCS-2 | `docs/product/specs/platform-v1/phase6-data-migration-spec.md` | P0 | Фаза 6 | Миграция legacy-данных в v1-схему: маппинг таблиц, порядок, rollback-план, dry-run. |
| DOCS-3 | `docs/product/specs/platform-v1/phase7-onboarding-wizard-spec.md` | P0 | Фаза 7, P0-3 | Флоу подключения property-admin от пустого tenant до работающего объекта. |
| DOCS-4 | `docs/product/specs/platform-v1/qr-passes-cutover-spec.md` | P0 | Фаза 7 | Cut-over legacy `qr_passes` → `visit_logs_v2` — отложен из Фазы 3. |
| DOCS-5 | `docs/product/specs/domhub-operational-runbooks-index.md` | P0 | P0-5 | Единый индекс runbooks + incident-процесс + эскалация. Сейчас 6 файлов в `docs/runbooks/` без зонтичного файла. |
| DOCS-6 | `docs/product/specs/domhub-security-threat-model.md` | P1 | RISK-4, P2-4 | Threat model для access + ПД + биометрии. Блокирует юр-аудит до коммерческого старта и любые биометрические фичи. |
| DOCS-7 | `docs/product/specs/domhub-event-taxonomy-spec.md` | P1 | P1-1 (event sourcing) | Формальный словарь событий для analytics/audit/integrations. Обязателен **до** P1-1, иначе придётся переделывать таксономию задним числом. |
| DOCS-8 | `docs/architecture/migration-runner-spec.md` | P1 | ARCH-4 | Per-property DB migration infra: retry/rollback/reconciliation/observability runner. |
| DOCS-9 | `docs/api-versioning-policy.md` | P1 | ARCH-6 | Политика deprecation/sunset для `/api/v1` → `/api/v2`. Сейчас в `openapi.json` есть `x-api-versioning`, но правил нет. |
| DOCS-10 | OpenAPI coverage audit + fix `docs/openapi.json` | P1 | — | Проверить и закрыть покрытие на все Phase 2/3 v1-роуты (`/residents`, `/vehicles`, `/access-requests`, `/passes`, `/visit-logs`, `/access-incidents`, `/access-overrides`, `/qr-passes-v2`). |
| DOCS-11 | `docs/product/specs/domhub-ui-screen-map.md` | P2 | BRAND-4 | Полная карта экранов × ролей; предусмотрено в `missing-docs-priority.md` П.12. |
| DOCS-12 | `docs/product/specs/domhub-release-gate-checklists.md` | P2 | — | Формальные release gates (A/B/C/D/E) вне `first-working-mvp-checklist.md` как переиспользуемый артефакт. |
| DOCS-13 | `docs/feature-flags-catalog.md` | P2 | ARCH-5 | Текущий `properties.feature_flags JSONB` не задокументирован — список ключей, владельцы, default-значения, lifecycle. |
| DOCS-14 | `docs/adr/README.md` | P2 | — | Индексный файл со сводкой ADR 001–011 (сейчас только отдельные файлы). |

### BRAND — дизайн, токены, логотип

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| BRAND-1 | Design freeze decision (dark vs light) | P1 | — | Формально зафиксировать: действующее направление = `domhub-design-tokens-css-spec.md` (light-first, «quiet luxury operations»). Legacy `frontend/src/design-system/README.md` («Premium dark theme v2.0») пометить `Deprecated`. |
| BRAND-2 | Финализация логотипа + замена placeholder | P1 | BRAND-1 | `frontend/src/constants/logo.ts` сейчас base64-плейсхолдер (~34 КБ WebP, без metadata). Нужен финальный SVG + lock-up + favicon + правила использования в `docs/brand/logo-usage.md`. |
| BRAND-3 | Миграция кода под токены из `design-tokens-css-spec` | P1 | BRAND-1, ARCH-8 | `frontend/src/styles/ds-tokens.css` привести к контракту из спеки (`--color-brand-forest-*`, `--color-ivory-*`, `--color-gold-*`, Manrope + Cormorant); v1 UI (`frontend/src/v1/ui/`) перевести на эти токены. |
| BRAND-4 | Figma foundation + components + screens | P2 | BRAND-1, DOCS-11 | Материализовать `MVP-02..MVP-07` из `domhub-first-working-mvp-jira-backlog.md`: Figma файл, foundations, component library, frozen screens для resident / security / staff / admin. |

### OPS — операционные документы

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| OPS-1 | SLA / SLO / RTO / RPO — engineering-side | P0 | P0-5 | Конкретные числа: uptime target, latency p95/p99, время восстановления. В `docs/legal/b2b/sla.md` есть общий юр-текст — нужен технический SLO-doc с метриками и error-budget. |
| OPS-2 | On-call rotation + escalation matrix | P0 | P0-5, DOCS-5 | Кто дежурит, окна ответа, как эскалируется, контакты. |
| OPS-3 | Disaster recovery plan (single-VPS baseline) | P1 | ARCH-7 | Текущий VPS = SPOF. Нужен runbook: как восстановиться из backup, RTO/RPO цифры, контакт Timeweb, процедура re-provision. |
| OPS-4 | Secrets rotation policy | P1 | — | Как часто и кем ротируются `JWT_SECRET`, OTP-секреты, API-keys, upload-signing secret; где хранятся; процедура компрометации. |
| OPS-5 | Tenant provisioning audit | P2 | P0-3 | Проверить полноту `operations/onboarding/launch-checklist.md` и `property-launch-guide.md` против P0-3 onboarding wizard; закрыть gaps. |
| OPS-6 | Data retention mapping per table | P2 | `legal/compliance/retention-and-deletion-standard.md` | Операционный mapping общего стандарта на конкретные таблицы (`visit_logs_v2`, `access_incidents`, `audit_log`, `notifications_outbox` и др.) с TTL и политикой удаления/анонимизации. |

### ENT — enterprise / open-source hygiene

| # | Артефакт | Приоритет | Описание |
|---|---|---|---|
| ENT-1 | `LICENSE` в корне репозитория | P1 | Сейчас только `frontend/LICENSE`. В корне — нет. Блокер для любого переговора про IP / sublicensing / передачу УК. |
| ENT-2 | `SECURITY.md` в корне | P1 | GitHub security policy. Куда писать про CVE, SLA ответа, PGP-ключ для responsible disclosure. |
| ENT-3 | `.github/CODEOWNERS` | P2 | Кто обязательный ревьюер для каких путей (платформа vs integrations vs docs). |
| ENT-4 | `CONTRIBUTING.md` в корне | P2 | Code style, PR-checklist, branch policy; часть есть в `CLAUDE.md`/`AGENTS.md` — нужен human-facing вариант. |
| ENT-5 | Формальный `CHANGELOG.md` (semver) | P2 | Заменить/дополнить `CHANGES.md` + `FIXES.md` release-notes'ами, привязанными к версиям. |

### LOAD — нагрузочное тестирование

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| LOAD-1 | План нагрузочных сценариев | P1 | OPS-1 | Папка `loadtest/` есть, но задокументированных сценариев нет. Нужен `docs/loadtest/scenarios.md`: guard-scan peak, concierge queue burst, resident evening peak, notifications fanout. |
| LOAD-2 | SLO-цели по нагрузке | P1 | OPS-1 | Конкретные числа per-endpoint: RPS на `/passes/verify`, p95 на `/access-requests POST`, throughput на outbox dispatcher. |
| LOAD-3 | Capacity model per-tenant | P2 | ARCH-4 | Сколько объектов помещается на один VPS: 1 tenant × N residents × M req/day = K DB-ops/s + CPU + RAM. Нужно для sizing перед коммерческими продажами. |
| LOAD-4 | Регулярный load-run | P2 | LOAD-1 | Сейчас `loadtest/` = однократные скрипты. Нужна периодика (weekly/monthly на staging) и регрессия. |

### A11Y — доступность

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| A11Y-1 | WCAG 2.1 AA baseline audit | P1 | BRAND-1 | Первичный audit v1 UI (resident / guard / concierge) + admin SPA. `.agents/skills/accessibility` загружен, но не применён к коду. Нужен отчёт по компонентам + план исправлений. |
| A11Y-2 | Keyboard navigation audit | P1 | A11Y-1 | Все флоу проходимы с клавиатуры. Guard console критичен — зимой охрана в перчатках не всегда использует touch/mouse. |
| A11Y-3 | Контраст под новые токены | P2 | BRAND-3 | При миграции на `--color-brand-forest-*` / `--color-ivory-*` проверить цветовой контраст AA для всех пар text × surface. |
| A11Y-4 | Screen reader / ARIA coverage | P2 | A11Y-1 | `aria-live` для guard scan result и queue updates; корректные role/label для custom-компонентов. |

### PERF — performance budgets

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| PERF-1 | Bundle size budget + CI gate | P1 | `docs/adr/005-bundle-performance-governance.md` | ADR есть — превратить в CI-gate: `frontend` bundle не должен превышать лимит. Сейчас мониторится вручную. |
| PERF-2 | Lighthouse CI для ключевых экранов | P2 | A11Y-1 | resident home + guard console + concierge detail — baseline LCP/CLS/INP + alerting на регрессии. |
| PERF-3 | Core Web Vitals SLO в Grafana | P2 | P0-4 | RUM-метрики от реальных пользователей, дашборд per-tenant. |
| PERF-4 | DB query budget per endpoint | P2 | ARCH-2 | Каждый `/api/v1/*` должен укладываться в бюджет p95 (напр. 150ms). Запросы выше бюджета — регрессия-инцидент. |

### I18N — локализация

| # | Задача | Приоритет | Описание |
|---|---|---|---|
| I18N-1 | Политика локализации | P2 | Сейчас всё hardcoded на русском (UI-строки, ошибки бэка, email/SMS-шаблоны). Нужна позиция: i18n-now (extract под `react-intl`/`i18next`) или i18n-later (pragma в ADR). Без решения каждая новая строка закрепляет RU. |
| I18N-2 | Форматы даты / времени / валюты | P2 | Сейчас частично `toLocaleDateString('ru-RU')` inline. Нужен центральный util + политика. |
| I18N-3 | English UI для SPA admin | P3 | Продажа зарубежным УК/девелоперам потребует EN. Отложено. |

### DATA — backup / recovery

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| DATA-1 | Первый restore drill | P0 | OPS-3, P0-5 | `backup.sh` в корне есть, unit-тестов реального restore нет. До go-live — провести хотя бы один end-to-end drill с замером времени (RTO baseline). |
| DATA-2 | Backup integrity check | P1 | DATA-1 | Автоматизированная проверка: каждый backup читается / восстанавливается в staging раз в период. |
| DATA-3 | Backup retention policy | P1 | OPS-6 | Сколько дней храним, где (local/offsite), кто owner, как удаляем, шифрование at-rest. |
| DATA-4 | Point-in-time recovery (PITR) | P2 | ARCH-7 | WAL-archiving на Timeweb Postgres или логическая репликация — сейчас только daily snapshot. |

### SEC-OPS — security operations

| # | Задача | Приоритет | Связано с | Описание |
|---|---|---|---|---|
| SEC-1 | CVE response runbook | P1 | ENT-2, DOCS-5 | Что делать при high-severity CVE в зависимостях: SLA на patch, процесс тестирования, rollout-стратегия. |
| SEC-2 | npm/dependabot triage cadence | P1 | SEC-1 | Dependabot включён (`.github/dependabot.yml`), но нет процесса: кто триажит PR, когда мерджит, что блокируется по CVSS. |
| SEC-3 | Pentest / security review план | P1 | DOCS-6 | Перед commercial-стартом — внешний pentest или хотя бы internal red-team exercise по access flow + tenant isolation. |
| SEC-4 | Access log review runbook | P2 | DOCS-5 | Как реагировать на подозрительные patterns в `audit_log` / `property_audit_log` (brute-force OTP, mass-create резидентов, unusual scan bursts). |
| SEC-5 | Rate-limit coverage audit | P2 | — | Rate-limit есть на auth endpoints, но нет аудита coverage на все `/api/v1/*` (особенно public `/passes/verify`). |

---

## Риски (для мониторинга)

Не задачи, а предупреждения. Пересмотр каждый месяц.

| # | Риск | Митигация |
|---|---|---|
| RISK-1 | Фокус-дрейф (6+ модулей + access + integrations) | Дисциплина по `IMPLEMENTATION_ORDER.md`; отказ от «заодно»-фич |
| RISK-2 | Зависимость от Замоскворечья | Регулярный фильтр «продукт или кастом?» |
| RISK-3 | СКУД-интеграции = предел качества | Long-term: абстрактный протокол / OEM-партнёрство |
| RISK-4 | Регуляторный: биометрия, КИИ, ОКЭС | Превентивный юр-аудит до коммерческого старта |
| RISK-5 | Масштабируемость per-property DB | Инвестировать в migration infra рано (см. ARCH-4) |
| RISK-6 | Сезонность продаж (Q4-Q1) | Планировать sales-готовность к октябрю |

---

## Done

Пункты, переведённые в этот раздел при завершении. Пример:
- ~~Superadmin SPA (admin.domhub.su)~~ — 2026-04 (commit `2248bdd`)
- ~~Platform-v1 scaffold (Phase 0)~~ — 2026-04-22 (commit `79241c3`)
- ~~Phase 1 — properties/MC layer + audit-log extension + SPA~~ — 2026-04-23 (D-lite ROADMAP §"Фаза 1"; 55 новых unit-тестов)
- ~~Phase 2 — Structure + People layer (buildings/entrances/units/residents/staff_users/contractor_companies/contractor_users)~~ — 2026-04-23 (D-lite ROADMAP §"Фаза 2"; 59 новых unit-тестов, 556 total pass)
- ~~Phase 3 — Access-core (vehicles/access_requests/access_approvals/passes/qr_passes_v2/visit_logs_v2/access_incidents/access_overrides + verify-pass service)~~ — 2026-04-23 (D-lite ROADMAP §"Фаза 3"; 8 миграций, 5 routes, 1 сервис, 3 новые спеки, 62+45+17=124 новых unit-тестов, 655 total pass; cut-over legacy qr_passes → visit_logs_v2 отложен на Фазу 7)
- ~~Phase 4 — Frontend access-core (resident page + guard console + concierge detail + `/v1/*` router)~~ — 2026-04-23 (D-lite ROADMAP §"Фаза 4"; `frontend-phase4-spec.md`; 3 страницы, 9 ui-компонентов, 9 api-клиентов, V1Router + RoleGate, 31 новый unit-тест; backend: `property_id` добавлен в `/users/me`; все проверки зелёные — frontend lint/typecheck/v1-tests, backend 46 suites / 655 tests; D-lite §2 соблюдён — v1/ не импортирует из legacy)
- ~~Phase 5 — Content + Notifications (announcements_v2, packages_v2, documents_v2, notifications-outbox + workers, notification_log_v2, scheduled-fanout + package-SLA runners, admin outbox, outbox health/retry, notification-templates-v2)~~ — 2026-04-24 (PR #124; ~32 коммитов; 6 v1-routes + 6 services + 4 workers + 7 миграций v1_016..v1_022; admin SPA: AnnouncementsAdminPage / DocumentsAdminPage / PackagesAdminPage; resident: ResidentAnnouncementsFeedPage / ResidentDocumentsPage / ResidentPackagesPage; spec'ы — `notifications-outbox-spec.md`, `announcements-v2-spec.md`, `packages-v2-spec.md`, `documents-v2-spec.md`, `notification-log-v2-spec.md`)
- ~~Phase 6 — Frontend v1 + legacy freeze gate~~ — 2026-04-24 (PR #124; ~12 коммитов; V1Router + RoleGate + admin pages + resident pages + session/role predicates; `legacy_utilities_enabled` feature flag + middleware wiring в registerApiRoutes.js + `v1LegacyUtilitiesFrozen.test.js` smoke; spec — `legacy-utilities-freeze-spec.md`; freeze покрывает chat/meter-readings/billing/spaces/bookings — все 5 endpoints возвращают 404 FEATURE_DISABLED при default state)
- ~~Phase 7 P5b audit blockers — 13 closed for go-live readiness~~ — 2026-04-24 (PR #124; 8 коммитов; multi-tenant routing wired, audit_log → property_audit_log rename across 19 files, race-safe transactions для approve/issue, ops hardening для outbox-health/retry, security middleware: markdown sanitizer XSS, normalizePlate, verifyPass; security review: `npm audit` 0/598 backend + 0/655 frontend, owasp-top10-expert 0 HIGH / 0 MEDIUM)
- ~~Phase 7 deploy infrastructure~~ — 2026-04-25 (PR #131; deploy/ folder с bundle.sh + check-config.sh + .env.production.template + backend/.dockerignore; runbook — `docs/product/specs/platform-v1/go-live-zamoskv-runbook.md`; **остаётся:** реальное выполнение runbook'а на VPS — не engineering, а ops action)
- ~~Migration 011 fix (push_subscriptions FK type + idx_announcements_active immutable predicate)~~ — 2026-04-26 (PR #132; разблокировка свежих БД от PG error 42804/42P17 — обязательно до go-live)
- ~~Audit P1/P2 hardening (TS strict, OpenAPI 9→33 paths, a11y Login + PassesTab, pagination helper + 12 list endpoints, idempotency middleware + 7 create POSTs, forward-only migrations policy, frontend pagination types + usePaginatedList hook)~~ — 2026-04-26 (PRs #133-#143; 9 PR; `backend/src/v1/lib/pagination.js`, `frontend/src/v1/hooks/usePaginatedList.ts`, `docs/api/README.md`, `backend/src/v1/migrations/README.md`)

---

## Rejected

Пункты, явно отклонённые с датой и причиной. Пусто.

---

## Changelog приоритетов

Любое изменение приоритета — запись здесь.

| Дата | Пункт | Было | Стало | Причина |
|---|---|---|---|---|
| 2026-04-22 | — | — | — | Первая версия бэклога |
| 2026-04-23 | DOCS-1..14 / BRAND-1..4 / OPS-1..6 / ENT-1..5 | — | new | Gap-аудит всех документов и артефактов: 29 пунктов добавлены единым блоком «📚 Документы и артефакты» после Архитектурных улучшений. Источник: сквозной sweep `docs/`, `BACKLOG.md`, `ROADMAP.md`, `.github/`, `ops/` + сверка с `docs/product/specs/domhub-missing-docs-priority.md` (5 из 14 всё ещё не закрыты). Приоритеты расставлены по влиянию на уже существующие P0–P2 задачи. |
| 2026-04-23 | LOAD-1..4 / A11Y-1..4 / PERF-1..4 / I18N-1..3 / DATA-1..4 / SEC-1..5 | — | new | Второй проход gap-аудита по нефункциональным требованиям (NFRs): 24 пункта добавлены в тот же блок. Покрывают нагрузку, доступность, performance budgets, локализацию, backup/restore, security ops. DATA-1 (restore drill) стал P0 — до go-live обязателен. |
| 2026-04-27 | Phase 5 / Phase 6 / Phase 7 P5b blockers | P0 IN_PROGRESS | Done | Закрытие drift'a между BACKLOG (помечал TODO) и реальностью кода. Phase 5/6/7-blockers фактически замёржены в PR #124 (2026-04-24); deploy infra — PR #131 (2026-04-25); migration 011 + audit hardening — PRs #132-#143 (2026-04-26). Остаётся только **execution на VPS** (DNS + secrets + docker compose up + smoke), не engineering work. |
| 2026-04-27 | P0-1 D-lite refactor | IN_PROGRESS | Done (code) | Все 7 фаз завершены в коде. Оставшиеся P0 blockers до go-live: P0-4 (Grafana per-tenant), P0-5 (runbook index — `go-live-zamoskv-runbook.md` есть, нужен индексный файл по `docs/runbooks/`), DATA-1 (первый restore drill). |
| 2026-04-27 | P0-2 Outbox pattern | TODO | Done | Реализован в PR #124: `backend/src/v1/services/notificationOutbox.js` + 4 workers (outboxRunner, outboxWorker, scheduledFanoutRunner, packageSlaRunner) + миграция v1_016. |
