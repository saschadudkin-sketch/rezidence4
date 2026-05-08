# Flow Spec — `qr-verification` (platform-v1)

**Фаза:** 3 (Access-core)
**Статус:** Draft
**Тип:** Flow spec (не entity) — описывает **сквозной процесс scan → verdict → log → (optional) incident**
**Задействованные сущности:** `passes`, `qr_passes`, `visit_logs`, `access_incidents`, `access_overrides`, `vehicles`
**Миграция:** не создаёт новые таблицы; опирается на `011–015`

---

## 1. Назначение

`qr-verification` — единственный endpoint, через который происходит любая проверка пропуска на посту: охранник в guard-console сканирует QR или вводит госномер, система отвечает verdict'ом (allow/deny) и пишет запись в `visit_logs`. При deny — опционально создаёт `access_incident` для управления в очереди.

В legacy-коде эта логика **размыта**:
- Guard-страница дергает `GET /api/requests/:id` (целый access request, вместо scoped pass)
- Проверка expiry делается на фронте (`valid_until < now` в JS)
- `qr_passes.used_at/used_by_uid` обновляется через `POST /api/requests/:id/use` — отдельный роут без аудита
- Запись о deny-попытке **не сохраняется нигде** — охранник закрыл страницу, попытка исчезла
- Нет идемпотентности: повторный скан того же QR через 2 сек может создать дубль `used_at` update или показать противоречие

**В platform-v1 мы делаем:**
- Один endpoint `POST /api/v1/visits/verify` инкапсулирует всю логику
- Сервер-side проверки: status, time window, blacklist, provider-conflict
- Каждый verdict → `visit_log` row (allow или deny) — источник правды
- Deny с определёнными причинами → auto-created `access_incident`
- Идемпотентность на окне 30s по `(token, performer)` — повторный скан возвращает предыдущий verdict + existing visit_log без второго INSERT

---

## 2. Use-cases

Flow покрывает пять сценариев guard-console:

1. **QR-скан резидента/гостя/подрядчика** — `{ mode: 'qr', token: '...' }`
2. **Ввод госномера** (авто без QR; охранник вручную вводит plate) — `{ mode: 'plate', plate: 'А001АА77' }`
3. **Manual admit без pass** (охранник пропускает знакомого) — `POST /api/v1/security-workspace/manual-decision` with `{ decision: 'manual_admit', person_label: '...', reason: '...' }`
4. **Manual deny без pass** (подозрительный посетитель) — `POST /api/v1/security-workspace/manual-decision` with `{ decision: 'manual_deny', person_label: '...', reason: '...' }`
5. **СКУД-вебхук** (провайдер присылает событие вместо охранника) — `{ mode: 'provider', provider_event_id, event_type, occurred_at, ... }`

В v1 `POST /api/v1/visits/verify` принимает `mode='qr'` и `mode='plate'` от guard-console. `manual_admit/manual_deny` идут через `POST /api/v1/security-workspace/manual-decision`, который атомарно пишет `visit_logs_v2`, `access_incidents(manual_override, resolved)`, `access_overrides` и sensitive audit. `provider` — отдельный webhook endpoint, но использует тот же core-сервис (`services/verify-pass.js`).

---

## 3. Алгоритм verify-сервиса

Псевдокод в service layer (backend/src/v1/services/verify-pass.js):

```
function verifyPass({ property_id, mode, token?, plate?, performed_by_staff_id, provider_event_id? }) {
  // 1) Idempotency check
  if (provider_event_id) {
    existing = visit_logs.findOne({ event_source, provider_event_id })
    if (existing) return buildVerdict(existing)
  }
  if (mode === 'qr') {
    recent = visit_logs.findOne({
      pass_id: resolvedFromToken,
      performed_by_staff_id,
      occurred_at > now - 30s,
    })
    if (recent) return buildVerdict(recent)
  }

  // 2) Resolve subject
  let pass = null, vehicle = null
  if (mode === 'qr')    pass = passes.findByToken(token)
  if (mode === 'plate') { vehicle = vehicles.findByPlate(plate); pass = findActivePassForVehicle(vehicle) }

  // 3) Verdict cascade (первое сработавшее правило выигрывает)
  let verdict = { allowed: false, reason: null, incident_type: null, event_type: 'entry_denied' }

  if (mode === 'qr' && !pass) {
    verdict = { allowed: false, reason: 'invalid_qr', incident_type: 'invalid_qr', severity: 'medium' }
  } else if (vehicle?.flags.includes('blacklist')) {
    verdict = { allowed: false, reason: 'vehicle_blacklisted', incident_type: 'blacklist_hit', severity: 'high' }
  } else if (pass?.status === 'revoked' || pass?.status === 'blocked') {
    verdict = { allowed: false, reason: `pass_${pass.status}`, incident_type: 'blacklist_hit', severity: 'high' }
  } else if (pass?.status === 'expired' || now > pass?.valid_until) {
    verdict = { allowed: false, reason: 'expired', incident_type: 'expired_pass_attempt', severity: 'low' }
  } else if (now < pass?.valid_from) {
    verdict = { allowed: false, reason: 'outside_time_window', incident_type: 'outside_time_window', severity: 'low' }
  } else if (vehicle && !pass && !vehicle.flags.includes('whitelist')) {
    verdict = { allowed: false, reason: 'unauthorized_vehicle', incident_type: 'unauthorized_vehicle', severity: 'medium' }
  } else {
    verdict = { allowed: true, event_type: 'entry_allowed' }
  }

  // 4) Suspicious repeat detection
  if (!verdict.allowed) {
    recent_denies = visit_logs.count({
      pass_id: pass?.id, vehicle_plate: plate,
      event_type: 'entry_denied',
      occurred_at > now - 10min,
    })
    if (recent_denies >= 2) {  // это будет 3-й (0, 1 → current = 3)
      verdict.incident_type = 'suspicious_repeat_attempt'
      verdict.severity = 'high'
    }
  }

  // 5) Write visit_log (append-only)
  visit_log = visit_logs.insert({
    property_id, pass_id: pass?.id, vehicle_plate: plate,
    event_type: verdict.event_type,
    event_source: mode === 'provider' ? 'skud' : 'guard_console',
    performed_by_staff_id, provider_event_id,
    person_label: resolvedPersonLabel(pass, vehicle),
    occurred_at: payload.occurred_at ?? now,
  })

  // 6) Auto-create incident
  if (!verdict.allowed && verdict.incident_type) {
    access_incidents.insert({
      property_id,
      related_pass_id: pass?.id,
      related_visit_log_id: visit_log.id,
      related_vehicle_id: vehicle?.id,
      incident_type: verdict.incident_type,
      severity: verdict.severity,
      status: 'open',
      title: buildIncidentTitle(verdict),
      created_by_staff_id: null,  // system-created
    })
  }

  // 7) Update pass status for one-shot passes on success
  if (verdict.allowed && pass && ['guest','courier','service'].includes(pass.pass_type)) {
    passes.update(pass.id, { status: 'used' })
  }

  // 8) Audit
  property_audit_log.insert({ entity_type: 'visit_log', entity_id: visit_log.id, action: verdict.event_type })

  return { verdict, visit_log_id: visit_log.id, pass_id: pass?.id, incident_id }
}
```

Вся последовательность — одна БД-транзакция (steps 5–8). Если fail на шаге 6 — откат 5; guard получает 500, пишется retry-friendly error.

---

## 4. API

### `POST /api/v1/visits/verify`

Роль: `security` (guard-console). SSE push обновляет `access_incidents` channel для property_admin.

**Request:**
```json
{
  "mode": "qr" | "plate",
  "token": "base64url-string",              // для mode='qr'
  "plate": "А001АА77",                      // для mode='plate', нормализуется в сервисе
  "access_point_id": "uuid",                // optional; active access point for this property
  "occurred_at": "2026-04-23T10:15:00Z"     // optional; default = now
}
```

**Response (allowed):**
```json
{
  "allowed": true,
  "visit_log_id": "uuid",
  "pass": {
    "id": "uuid", "pass_type": "guest",
    "subject_label": "Иванов Иван Иванович",
    "valid_until": "2026-04-23T18:00:00Z"
  }
}
```

**Response (denied):**
```json
{
  "allowed": false,
  "reason": "expired" | "invalid_qr" | "vehicle_blacklisted" | "pass_revoked" | "pass_blocked"
          | "outside_time_window" | "unauthorized_vehicle",
  "visit_log_id": "uuid",
  "incident_id": "uuid",
  "pass": { "id": "uuid", "pass_type": "guest", "subject_label": "..." } | null
}
```

Не возвращаем `200 Unauthorized`-стиль ошибку за deny — это валидный бизнес-ответ, `200 OK { allowed: false }`. `403` только если тот, кто дергает, не имеет роли `security`.

### `POST /api/v1/skud/events` (webhook, пост-релиз — stub в v1)

Входит в ту же сервис-функцию, но auth через HMAC-подпись провайдера, а не JWT. В v1 endpoint существует, но обслуживает только тестовый mock-провайдер (e2e-тесты Фазы 3).

---

## 5. Migrations from legacy

Этот flow не требует миграции данных (нет persistent state, кроме `visit_logs` — см. `visit-logs-spec §5`). Перенос происходит **кодом:**

| Legacy вызов | v1 замена | Где |
|---|---|---|
| `POST /api/requests/:id/use` | `POST /api/v1/visits/verify { mode: 'qr', token }` | Frontend: `src/views/GuardConsole.tsx` |
| `GET /api/requests/:id` (для guard display) | `GET /api/v1/passes/:id` | Подменяется на fetch-of-pass после verify |
| `qr_passes.used_at + used_by_uid` UPDATE | INSERT в `visit_logs` + pass.status='used' (для one-shot) | backend/src/v1/services/verify-pass.js |
| JS check `valid_until < now` на фронте | убираем; сервер авторитетен | Удалить `frontend/src/views/GuardConsole.tsx:L?` |

Cutover в Фазе 7 — вместе с остальной access-миграцией.

---

## 6. Acceptance criteria

- [ ] Сервис `verify-pass.js` покрыт unit-тестами для каждой ветки cascade (8 веток) + happy path + idempotency (30s window + provider_event_id)
- [ ] Integration-тест: последовательность `verify(expired pass) → verify(same pass)` создаёт **один** incident, не два (idempotency по `(related_visit_log_id, incident_type)` в incidents-сервисе)
- [ ] Performance: p95 verify endpoint < 150ms на dev DB с 10k passes + 100k visit_logs
- [ ] `allowed=false` с отсутствующим `incident_id` — баг; тест это ловит
- [ ] `mode='plate'` с нормализацией (кириллица → латиница через `normalizePlate`) покрыт тестом для «А001АА77» → находит vehicle с plate_number='A001AA77'
- [ ] 3-й deny за 10 минут поднимает severity до 'high' и устанавливает `incident_type='suspicious_repeat_attempt'`
- [ ] One-shot pass (`pass_type='guest'`) после `allowed` verify имеет `status='used'`, второй verify того же token → `allowed=false` с `reason='pass_used'` (добавляем в cascade §3 step 3)
- [ ] Multi-use pass (`pass_type='resident'`) после 10 `allowed` verify — status по-прежнему `'active'`
- [ ] Audit-trail: `property_audit_log` содержит по одной записи на каждый verify (allow или deny)
- [ ] Optional `access_point_id` валидируется через DH-06 topology и сохраняется в `visit_logs_v2`

---

## 7. Открытые вопросы

1. **Что делать с `pass.status='used'` на multi-use пропусках в legacy-истории?** → **Решено:** после миграции все `resident/staff/vehicle` passes получают `status='active'`; `used` ставится только при миграции one-shot (guest/courier/service). В cascade это уже отражено — `used` проверяется ДО expiry (новое правило, добавим в step 3): `if (pass.status === 'used') deny 'pass_used'`.
2. **Идемпотентность 30s у guard-console.** Защита от двойного скана — но что если охранник **намеренно** сканирует повторно после первого deny (второй шанс)? → **Решено:** окно 30s применяется **только к `allowed=true`** сканам. После deny guard может сразу скан повторить — получит новый visit_log и, возможно, подъём severity (suspicious_repeat_attempt).
3. **`normalizePlate` cyrl→latin.** Описан в `vehicles-spec §3`; verify-сервис его переиспользует через shared helper. Плейтхолдер плейта («XXX000») — `allowed=false, reason='invalid_plate'` (добавим в cascade между step 2 и step 3).
4. **SSE channel для incidents.** После создания incident — push в property_admin guard-console channel. → **Решено:** переиспользуем `/api/v1/events/stream?channels=access-incidents`, emit по tenant. Реализация в рамках Фазы 3 (но текст спеки живёт здесь, а не в `events-spec`).
5. **Offline guard (интернет пропал).** Что делать с verify? → **Не в v1.** Гвард-console требует online. В ROADMAP зафиксировано как item пост-релиз: «offline queue + sync при восстановлении связи». В v1 показываем на фронте явный баннер «нет связи — verify недоступен».
6. **Rate limiting.** Не боимся ли brute-force по `token`? → **Решено:** токены достаточно длинные (128 bits entropy); rate limiter per-IP на роут `verify` — 60/min (уровень nginx/express-rate-limit), не внутри сервиса. Документация в `docs/ops/rate-limits.md` (TODO Фаза 4).
