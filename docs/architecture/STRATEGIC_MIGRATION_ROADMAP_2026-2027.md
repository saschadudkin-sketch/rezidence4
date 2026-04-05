# Strategic roadmap: архитектурная миграция frontend (2026–2027)

**Версия:** 1.0  
**Дата утверждения:** April 5, 2026  
**Горизонт:** Q2 2026 → Q2 2027  
**Область:** `frontend/*` + интеграционные контракты `backend/*` (API/SSE)

---

## 1) Цели миграции (north-star)

1. **Predictable UX at scale**
   - Единый контракт состояний/копирайта/доступности.
   - SLA UX: p95 time-to-interactive и p95 reconnect в целевых пределах.
2. **Bounded architecture**
   - Чёткие контексты доменов (auth, requests, chat, residents/admin/security).
   - Минимизация shared mutable state и каскадных ререндеров.
3. **Operational excellence**
   - Наблюдаемость (telemetry + error taxonomy + SLA dashboards).
   - Релизные гейты и rollback-плейбуки на уровне platform quality.
4. **Delivery speed without regressions**
   - Инкрементальная миграция без big-bang.
   - CI policy-as-code для архитектурных ограничений.

---

## 2) Wave-план миграции

## Wave 0 — Governance baseline (April 8, 2026 → April 26, 2026)

**Цель:** закрепить architecture governance как обязательный gate.

### Объём
- Architecture Decision Registry v2 (ADR + RFC шаблоны).
- Quality gates в CI: style governance, UX contract, bundle budget, contract checks.
- Definition of Done v2: обязателен traceability к roadmap item.

### Exit criteria
- 100% PR в `frontend/` имеет roadmap-tag (`ARCH-*`, `UX-*`, `OBS-*`).
- `verify:all` блокирует merge при нарушении архитектурных ограничений.

---

## Wave 1 — UX Contract Completion (April 27, 2026 → June 7, 2026)

**Цель:** довести UX state contract до полного покрытия всех critical journeys.

### Объём
- Полное покрытие loading/empty/error для resident/concierge/security/admin.
- A11y contract: focus-visible, keyboard-only flows, modal focus trap policy.
- Copy registry с ownership и ревизионным журналом.

### KPI
- UX Contract Coverage ≥ 98% по целевым view-файлам.
- Axe critical violations = 0 на smoke journeys.

### Exit criteria
- Нет ad-hoc state-block текста вне `viewStateContract` для критических экранов.
- Smoke-пакет на ключевые роли (owner/security/admin) стабилен 2 недели.

---

## Wave 2 — Store Bounded Contexts v2 (June 8, 2026 → August 2, 2026)

**Цель:** завершить modular store migration до domain-oriented API.

### Объём
- AppStore остаётся composition root, доменные API выносятся в `store/domains/*`.
- Selector policy: запрет broad subscriptions без memoized selectors.
- Side-effect boundaries: все I/O в gateways/hooks, не в reducers.
- Action typing contract + runtime guardrails.

### KPI
- Avg rerenders на critical screens: -30% к baseline April 2026.
- No cross-domain regression incidents (P1/P2) в течение 2 релизов.

### Exit criteria
- Все домены имеют контракт: state/actions/selectors/effects.
- Архитектурный линтер блокирует cross-domain import violations.

---

## Wave 3 — Realtime Reliability & Health Model (August 3, 2026 → October 4, 2026)

**Цель:** перейти от «connected/disconnected» к health-model и управляемым деградациям.

### Объём
- Realtime health states: `healthy`, `degraded`, `failed`, `recovering`.
- RFC-001 data-layer policy (Query vs Realtime) mandatory for all new domain integrations.
- Backoff/replay/idempotency policy для SSE событий.
- Dead-letter telemetry для malformed events.
- Graceful degradation UX (read-only modes, queued actions).

### KPI
- SSE reconnect p95 ≤ 15s, p99 ≤ 30s.
- Unhandled realtime exception rate < 0.1% сессий.

### Exit criteria
- Runbook для инцидентов realtime (on-call + rollback).
- Synthetic checks в production-like environment.

---

## Wave 4 — Telemetry Contract & SLA Operations (October 5, 2026 → December 13, 2026)

**Цель:** сделать SLA dashboard источником release decisions.

### Объём
- Metric catalog v2 (UX, transport, action quality, auth/session recovery).
- SLA reporting aligned with RFC-001 data convergence and conflict-rate metrics.
- SLA dashboard с SLO error-budget logic.
- Alerting policy (warning/critical) + weekly reliability review.

### KPI
- 100% critical journeys покрыты telemetry events.
- SLA breach detection latency < 5 минут.

### Exit criteria
- Релизы блокируются при исчерпанном error budget.
- Недельные SLA отчёты автоматически публикуются.

---

## Wave 5 — Platform Simplification (January 11, 2027 → March 21, 2027)

**Цель:** упростить платформу и снизить стоимость изменений.

### Объём
- Удаление legacy paths, feature flags cleanup.
- API shape convergence (requests/chat/admin).
- Contract tests между frontend-backend на уровне schema.

### KPI
- Lead time PR→prod: -25% к baseline.
- Change failure rate: < 10%.

### Exit criteria
- Legacy removal checklist = 100%.
- Regression rate стабильна 2 квартала.

---

## Wave 6 — Scale & Enablement (March 22, 2027 → June 20, 2027)

**Цель:** масштабирование команды и устойчивой delivery-модели.

### Объём
- Engineering playbook (архитектурные паттерны + anti-patterns).
- Onboarding kit + reference implementations.
- Quarterly architecture fitness reviews.

### KPI
- New engineer productivity (first safe PR) ≤ 10 рабочих дней.
- Architecture policy violations trend → 0.

### Exit criteria
- Playbook принят во всех frontend streams.
- Fitness review cadence выполняется 2 квартала подряд.

---

## 3) Dependency map

- **D1:** UX contract completion → prerequisite для SLA quality baselining.
- **D2:** Store bounded contexts v2 → prerequisite для realtime health rollout.
- **D3:** Telemetry v2 → prerequisite для release gating по error budget.
- **D4:** Platform simplification → prerequisite для scale enablement.

---

## 4) Risk register

1. **Scope creep in multi-wave plan**
   - Mitigation: hard wave boundaries + backlog freeze внутри wave.
2. **Observability blind spots**
   - Mitigation: metric contract review перед каждым major release.
3. **Backward compatibility drift**
   - Mitigation: compatibility tests + deprecation policy (2 релиза minimum).
4. **Team bandwidth volatility**
   - Mitigation: reserve capacity 20% per sprint for migration tasks.

---

## 5) Governance cadence

- **Weekly (engineering):** roadmap progress + risk review.
- **Bi-weekly (product+engineering):** SLA + UX quality report.
- **Monthly (architecture board):** wave gate decision (continue/pivot/rollback).
- **Quarterly (leadership):** KPI outcome and re-baselining.

---

## 6) Definition of done for migration items

Каждая задача считается завершённой только при выполнении всех пунктов:

1. Есть ADR/RFC ссылка и roadmap-tag.
2. Есть автоматическая проверка (test/lint/contract check).
3. Есть telemetry impact statement.
4. Есть rollback инструкция (если меняется runtime behavior).
5. Есть owner и planned follow-up date.

