# Audit execution status (as of April 5, 2026)

Источник: `docs/DEEP_PRODUCT_UI_TECH_AUDIT_2026-04-05_v2.md`.

## 1) Top 10 проблем из аудита

| # | Пункт из аудита | Статус | Что сделано / что осталось |
|---|---|---|---|
| 1 | Accessibility (focus-visible + keyboard modal flows) | **In progress** | `:focus-visible` внедрён; modal contract унифицирован для ключевых overlay modal. Осталось покрытие всех диалогов/порталов e2e-проверками. |
| 2 | Responsive drift / breakpoints | **Done** | Breakpoint governance стандартизирован и проверяется CI. |
| 3 | Нестабильные visual contracts (loading/empty/error) | **In progress** | `viewStateContract` внедрён по ключевым экранам; требуется доведение покрытия до 100% по всем edge flows. |
| 4 | Session-expired UX recovery | **Done** | Есть session-expired event + return-to восстановление в auth flow. |
| 5 | Фрагментированная SSE/event архитектура | **In progress** | Typed events + realtime state machine внедрены; требуется полный health-model rollout по всем доменам. |
| 6 | Неунифицированные empty/loading/error блоки | **In progress** | В основном унифицировано через `StateBlock` + contract, но остаются хвосты в non-critical/legacy участках. |
| 7 | Резкий session-expired UX без контекста | **Done** | Контекст возврата и auth notice реализованы. |
| 8 | Dual data-layer без формальной стратегии | **In progress** | RFC-001 принят; требуется поэтапная имплементация policy+metrics во всех доменах. |
| 9 | Fan-out requests загрузка без лимита | **Done** | Введён concurrency limit для `requestsProvider.getAll`. |
| 10 | Governance performance budgets по маршрутам | **In progress** | Route budgets добавлены; требуется жёсткий release gate на уровне error budget policy. |

## 2) Quick Wins (1–2 дня)

| Quick win | Статус |
|---|---|
| focus-visible + keyboard visual baseline | **Done** |
| breakpoint unification | **Done** |
| state-block standard на ключевых экранах | **Done** |
| session-expired c redirect restore | **Done** |
| requests concurrency cap | **Done** |
| CI-check raw media + raw color literals | **Partial** (media есть, color-literals policy требует усиления) |

## 3) Strategic improvements

| Strategic item | Статус |
|---|---|
| Data-layer strategy RFC | **Done** (RFC-001), rollout — **In progress** |
| Realtime core state machine | **In progress** |
| Role manifest platform | **In progress** |
| Store modularization bounded contexts | **In progress** |
| Design system hardening | **In progress** |

## 4) Риск на текущий момент

1. Основной риск — считать «документацию = завершение миграции».
2. Нужен execution discipline: wave gates, KPI tracking, еженедельный update статусов.

## 5) Следующий обязательный шаг

- Вести этот документ как живой execution-dashboard и синхронизировать статусы с `docs/architecture/migration-roadmap-tracker.yaml` каждую неделю (каждый понедельник).
