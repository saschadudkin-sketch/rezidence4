# Module Spec - `security-workspace` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft, backend baseline implemented
**Тикет:** DH-15 Security Workspace API, DH-16 Manual Override And Incident Flow
**Связанные спеки:** `access-topology-spec.md`, `access-policies-spec.md`, `visit-logs-spec.md`, `access-incidents-spec.md`

---

## 1. Назначение

`security-workspace` - backend API для рабочего места охраны. Он не заменяет CRUD ресурсов (`passes`, `visits`, `access-incidents`, `access-points`), а собирает guard-optimized feeds для быстрой первичной загрузки, поиска и последних событий.

Главный принцип: initial hydrate и incremental updates остаются разными контурами. Этот API отвечает за hydrate/search; SSE остаётся отдельным механизмом обновлений.

---

## 2. API

| Метод | Путь | Назначение |
|---|---|---|
| `GET` | `/api/v1/security-workspace/bootstrap?property_id=&access_point_id=` | Первичная загрузка рабочего места КПП |
| `GET` | `/api/v1/security-workspace/search?property_id=&q=` | Поиск по авто, пропускам, жителям и адресным единицам |
| `GET` | `/api/v1/security-workspace/recent-events?property_id=&access_point_id=` | Последние события прохода/проезда |
| `POST` | `/api/v1/visits/verify` with `direction=entry|exit` | Verify с направлением въезд/выезд |
| `POST` | `/api/v1/security-workspace/manual-decision` | Ручное решение охраны: admit/deny с visit log, incident, override и audit |

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
