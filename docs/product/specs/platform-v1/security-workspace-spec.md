# Module Spec - `security-workspace` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft, backend baseline implemented
**Тикет:** DH-15 Security Workspace API, DH-16 Manual Override And Incident Flow
**Связанные спеки:** `access-topology-spec.md`, `access-policies-spec.md`, `visit-logs-spec.md`, `access-incidents-spec.md`, `domhub-access-competitive-improvement-plan.md`

---

## 1. Назначение

`security-workspace` - backend API для рабочего места охраны. Он не заменяет CRUD ресурсов (`passes`, `visits`, `access-incidents`, `access-points`), а собирает guard-optimized feeds для быстрой первичной загрузки, поиска и последних событий.

Главный принцип: initial hydrate и incremental updates остаются разными контурами. Этот API отвечает за hydrate/search; SSE остаётся отдельным механизмом обновлений.

### 1.1 Product Vocabulary And Canonical Contracts

Эта спека участвует в Phase 0 alignment из `domhub-access-competitive-improvement-plan.md`.

Canonical contract:
- Guard console hydrates from `/api/v1/security-workspace/bootstrap`; SSE only applies incremental updates.
- Search, manual decisions and offline replay use `/api/v1/security-workspace/*` and `/api/v1/visits/verify`.
- Deprecated `/api/*` guard aliases are compatibility-only and must not be target contracts for new guard UX.

Guard vocabulary:
- Expected guests / arrivals: upcoming approved access requests and active passes in the current checkpoint window.
- Blacklist hits: open incidents and vehicle flags relevant to the selected property/access point.
- Guard notes: staff/security-only operational notes; never returned to public pass.
- Guest instructions: guest-facing text from the access request; safe to show on public pass and optionally in guard context.
- Trusted visitor context: expected guests and active passes include
  `trusted_visitor_id` when the access request came from a resident-owned
  frequent guest template. This is staff-only context and must stay property
  scoped.
- Guard authorized devices: future allow-list of devices/stations permitted to perform manual decision or hardware-control actions.

Out of first MVP:
- Face recognition / biometric identity matching.
- Wallet/BLE production credentials.
- Direct hardware open commands outside audited manual-control boundaries.

---

## 2. API

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/v1/security-workspace/bootstrap?property_id=&access_point_id=` | Первичная загрузка рабочего места КПП |
| `GET` | `/api/v1/security-workspace/search?property_id=&q=` | Поиск по авто, пропускам, жителям и адресным единицам |
| `GET` | `/api/v1/security-workspace/recent-events?property_id=&access_point_id=` | Последние события прохода/проезда |
| `POST` | `/api/v1/visits/verify` with `direction=entry|exit` | Verify с направлением въезд/выезд |
| `POST` | `/api/v1/security-workspace/manual-decision` | Ручное решение охраны: admit/deny с visit log, incident, override и audit |
| `POST` | `/api/v1/security-workspace/offline-replay` | Replay локально накопленных offline guard decisions с audit/reconciliation |

`access_point_id` является optional, но если передан, должен принадлежать тому же property и быть active.

`manual-decision` принимает `decision=manual_admit|manual_deny`, `direction=entry|exit`, обязательный `reason`, optional `pass_id`, `vehicle_id` / `related_vehicle_id`, `person_label`, `vehicle_plate`, `degraded_mode`, `degraded_reason`, `lookup_state`, `occurred_at`, `severity`. Если `degraded_mode=true`, backend сохраняет reconciliation state как `pending` в `visit_logs_v2.provider_payload`.

Manual decision response:

```json
{
  "visit_log": { "id": "uuid", "event_type": "manual_admit" },
  "incident": { "id": "uuid", "incident_type": "manual_override", "status": "resolved" },
  "override": { "id": "uuid", "override_type": "manual_admit" }
}
```

---

## 3. Bootstrap Response

```json
{
  "workspace": {
    "property_id": "uuid",
    "generated_at": "2026-05-05T09:00:00.000Z",
    "station_context": {
      "access_point": { "id": "uuid", "name": "КПП 1" },
      "access_zone": { "id": "uuid", "name": "Периметр" }
    },
    "active_passes": [],
    "expected_guests": [],
    "recent_events": [],
    "blacklist_hits": []
  }
}
```

---

## 4. Acceptance Criteria

- [ ] Security/admin users can hydrate the guard console with active passes, expected guests, recent events and blacklist hits.
- [ ] Search returns scoped vehicle-first results for cottage-community checkpoints.
- [ ] Access point context filters feeds where applicable.
- [ ] Cross-property tokens cannot read another property workspace.
- [ ] Verify supports `direction=entry|exit` and records corresponding visit event type.
- [ ] Security/admin users can record point-scoped manual admit/deny decisions.
- [ ] Manual decisions are written transactionally as visit log + resolved manual_override incident + override + sensitive audit log.
- [ ] Degraded-mode manual decisions preserve reason, lookup state, direction and pending reconciliation metadata.
- [ ] Tests cover query behavior and security scope.

---

## 5. Out Of Scope

- Visual guard console redesign.
- Video playback and device control.
- Local browser offline queue and later client replay UI.
