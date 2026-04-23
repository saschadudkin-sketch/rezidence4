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
| P0-1 | D-lite рефактор (Фазы 1–7) | 10 нед | IN_PROGRESS (Фаза 0 done) | Pre-deployment окно — разовое |
| P0-2 | Outbox pattern для notifications | 1 нед | TODO (в Фазе 5) | Inline-send ломает заявки при падении канала |
| P0-3 | Onboarding wizard для property-admin | 1 нед | TODO (в Фазе 7) | Без него подключение объекта = 2 дня ручной работы |
| P0-4 | Observability per-tenant (Grafana) | 4 дня | TODO (параллельно Фазе 1–2) | С go-live слепые проблемы = видимые резидентам |
| P0-5 | Runbook + incident-процесс | 2 дня | TODO (до Фазы 7) | Нет описания on-call / SLA / эскалации |

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
| ARCH-8 | Убрать inline `style={{…}}` из legacy product UI в пользу CSS-классов/токенов | P2 | На 2026-04-23 в `frontend/eslint.config.js` отключено правило `no-restricted-syntax` для `admin/pages/{AuditLogPage,DashboardPage,ManagementCompanyDetailPage,PropertyDetailPage}.tsx` и `components/ConsentModal.tsx`. Новые inline-стили туда добавлять нельзя; цель — вынести существующие в utility-классы или css vars. Не блокер, но лишает lint-сигнала по этим файлам. |

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

---

## Rejected

Пункты, явно отклонённые с датой и причиной. Пусто.

---

## Changelog приоритетов

Любое изменение приоритета — запись здесь.

| Дата | Пункт | Было | Стало | Причина |
|---|---|---|---|---|
| 2026-04-22 | — | — | — | Первая версия бэклога |
