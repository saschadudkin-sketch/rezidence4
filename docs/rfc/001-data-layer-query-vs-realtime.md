# RFC-001: Data-layer strategy — Query vs Realtime

## Metadata
- **RFC ID:** RFC-001
- **Status:** Accepted
- **Date:** April 5, 2026
- **Owner:** Frontend Architecture Board
- **Related ADRs:** ADR-011 (`docs/adr/011-strategic-migration-roadmap.md`)
- **Scope:** Frontend data layer (`frontend/src/services/*`, `frontend/src/hooks/*`, `frontend/src/store/*`)

---

## 1. Problem statement

В текущем продукте одновременно используются pull- и push-механизмы:

- **Query/polling** (инициализация, refetch, восстановление консистентности),
- **Realtime/SSE** (инкрементальные события и быстрый UX feedback).

Без формального контракта между ними возникают риски:

1. duplicate updates и race conditions;
2. несогласованный cache/store источник истины;
3. неочевидный fallback при деградации realtime;
4. отсутствие единых SLA и release-gate критериев для data-layer.

---

## 2. Goals / Non-goals

### Goals
1. Формализовать decision framework: когда использовать Query, когда Realtime, когда Hybrid.
2. Зафиксировать единый event/caching contract и source-of-truth policy.
3. Стандартизировать fallback/degradation поведения.
4. Установить измеримые SLA/SLO для data-layer reliability.

### Non-goals
1. Полная замена текущих transport-реализаций в один релиз.
2. Переписывание backend event pipeline в рамках этого RFC.
3. Внедрение websocket-протокола (out of scope для 2026).

---

## 3. Decision summary

Принимается **Hybrid-first модель**:

- **Query** — authoritative snapshot (bootstrap + revalidation + recovery).
- **Realtime** — incremental deltas для low-latency UX.
- **Store/UI** — принимает только нормализованные изменения через единый reducer/action layer.

### Canonical правило
> Если realtime доступен, UI питается дельтами + периодической revalidation.
> Если realtime деградирует/недоступен, система автоматически переключается на query-only mode без потери функциональности.

---

## 4. Data classes и routing policy

| Data class | Примеры | Freshness target | Strategy |
|---|---|---:|---|
| **Critical realtime** | заявки (status transitions), журнал входа, охрана | sub-second / seconds | Hybrid (SSE + periodic revalidate) |
| **Near realtime** | чат, counters, бейджи | seconds | Hybrid (SSE primary, query recovery) |
| **Transactional authoritative** | профили, настройки, permissions | minutes | Query-first (+ optimistic mutation events) |
| **Low volatility reference** | справочники, статические манифесты | hours/days | Query-only + versioned cache |

---

## 5. Source of truth contract

1. **Backend snapshot API** — authoritative baseline.
2. **Realtime event stream** — authoritative order of changes между snapshot windows.
3. **Client cache** — derived state, не долговечный source-of-truth.

### Consistency rules
- Любой SSE event применяется только через domain action (`set/update/delete`), без прямого мутационного доступа к state.
- Каждое N-минутное окно (по domain policy) выполняется revalidation query.
- При нарушении event continuity (gap/replay failure) domain помечается `degraded`, и запускается full refetch.

---

## 6. Event contract (Realtime)

Минимальный envelope для событий:

```json
{
  "eventId": "string",
  "entity": "requests|chat|users|perms|blacklist|garage",
  "op": "upsert|delete|replace",
  "version": 123,
  "timestamp": "2026-04-05T12:00:00.000Z",
  "payload": {}
}
```

### Contract requirements
- `eventId` globally unique (idempotency key).
- `version` monotonic per entity-stream.
- `op=replace` зарезервирован для controlled resync.

### Client behavior
- duplicate `eventId` → ignore.
- out-of-order version detected → mark domain degraded + trigger query revalidation.

---

## 7. Query contract

### Query responsibilities
1. bootstrap snapshot;
2. recovery after disconnect/degradation;
3. periodic revalidation;
4. explicit refetch on risky mutations.

### Query policy
- Критические домены: staleTime умеренный + background refetch.
- Низковолатильные домены: длинный staleTime + manual invalidation by version bump.

---

## 8. Conflict resolution

При расхождениях Query vs Realtime:

1. Приоритет у более новой `version`.
2. Если version неизвестна или mismatch, предпочтение snapshot query с последующим stream resubscribe.
3. Клиент обязан логировать conflict metric (`data.conflict.detected`).

---

## 9. Degradation and fallback policy

Состояния транспорта:
- `healthy`
- `degraded`
- `failed`
- `recovering`

### Policy
- `healthy`: realtime + periodic query revalidation.
- `degraded`: query interval уменьшается, realtime остаётся best-effort.
- `failed`: query-only mode, UI показывает soft warning.
- `recovering`: постепенное включение realtime, затем rollback к healthy.

---

## 10. SLA / SLO for data-layer

### SLO targets
1. **Realtime reconnect p95** ≤ 15s, p99 ≤ 30s.
2. **Data convergence lag p95** ≤ 10s для critical realtime domains.
3. **Query fallback availability** ≥ 99.9% для критических экранов.
4. **Conflict rate** < 0.5% сессий.

### Release gates
- Release блокируется при двух подряд неделях breach по любому critical SLO.

---

## 11. Rollout plan

### Phase 1 (April 2026)
- Утвердить RFC и контракты event/query.
- Включить метрики конфликтов и convergence lag.

### Phase 2 (May–June 2026)
- Применить hybrid policy к requests/chat domains.
- Включить degradation UI states + runbooks.

### Phase 3 (July–August 2026)
- Расширить на users/perms/blacklist.
- Ввести release-gate отчёты по SLO.

### Phase 4 (September 2026)
- Финальная валидация на production-like нагрузке.
- Формальная приёмка board-ревью.

---

## 12. Risks and mitigations

1. **Event ordering bugs**
   - Mitigation: version checks + idempotency + synthetic replay tests.
2. **Over-fetch in fallback mode**
   - Mitigation: adaptive query interval + domain-specific caps.
3. **Operator overload from noisy alerts**
   - Mitigation: alert routing (warning/critical) + dedup windows.
4. **Semantic drift between services**
   - Mitigation: contract tests and versioned schema checks in CI.

---

## 13. Acceptance checklist

- [x] Decision matrix Query/Realtime/Hybrid утверждён.
- [x] Event envelope и fallback policy формализованы.
- [x] SLO targets и release gates определены.
- [x] Пошаговый rollout с датами и ownership зафиксирован.

