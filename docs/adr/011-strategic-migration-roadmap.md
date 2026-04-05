# ADR-011: Strategic roadmap for architectural migration

## Status
Accepted — April 5, 2026

## Context
Deep audit показал, что точечные улучшения (UX contract, breakpoints, store split, telemetry) уже начаты, но без единой multi-wave governance-модели остаётся высокий риск:

- drift между командами и потоками задач;
- отсутствие единых exit criteria между этапами;
- слабая связка roadmap ↔ release gates ↔ SLA decisioning.

Нужен единый стратегический документ уровня платформы, который определяет **что**, **когда**, **зачем**, и **по каким критериям** считается завершённым.

## Decision
1. Утвердить единый стратегический roadmap-документ:
   - `docs/architecture/STRATEGIC_MIGRATION_ROADMAP_2026-2027.md`
2. Вести архитектурную миграцию wave-моделью (Wave 0..6) с жёсткими gate-решениями.
3. Принять governance cadence:
   - weekly engineering review,
   - bi-weekly product+engineering SLA review,
   - monthly architecture board gate.
4. Сделать обязательным traceability каждого PR к roadmap item и ADR/RFC.

## Consequences
### Positive
- Прозрачный путь миграции до mid-2027 без big-bang rewrite.
- Снижение регрессионного риска за счёт wave exit criteria.
- SLA становится реальным release gate, а не пост-фактум отчётом.

### Trade-offs
- Больше upfront-process overhead на каждую архитектурную задачу.
- Потребуется дисциплина по roadmap-tagging и регулярным ревью.

## Compliance
Для соответствия ADR-011 каждая архитектурная задача должна иметь:
- roadmap-tag,
- ссылка на RFC-001 для data-layer решений (Query vs Realtime),
- ссылку на ADR/RFC,
- автоматический quality gate,
- telemetry impact statement,
- rollback plan.

