# Module Spec — `auth-v1` (platform-v1)

**Фаза:** 2 (People layer — завершение)
**Статус:** Draft
**Источники:** legacy `backend/src/routes/auth.js`, middleware `backend/src/middleware/auth.js`
**Миграция:** не требуется на уровне БД; изменения только в shape JWT-claims

---

## 1. Назначение

В legacy JWT-токен содержит единое поле `uid` (primary key в таблице `users`) + `role`. После разделения `users` → `residents` / `staff_users` / `contractor_users` нужен новый claim, который однозначно указывает в какую таблицу идти за подробностями.

**Цель:** явный `subject_type` + `subject_id` в JWT; middleware резолвит правильную таблицу; роуты получают типизированный `req.subject`.

---

## 2. Shape JWT-claims

### Legacy (до Фазы 7)

```json
{
  "uid": "550e8400-e29b-41d4-a716-446655440000",
  "role": "resident",
  "propertySlug": "zamoskv",
  "iat": 1714000000,
  "exp": 1714003600
}
```

### v1 (введение в Фазе 2, coexistence с legacy до Фазы 7)

```json
{
  "subject_type": "resident",
  "subject_id": "550e8400-e29b-41d4-a716-446655440000",
  "property_id": "...",
  "role": "resident",
  "capabilities": { "can_view_resident_phone": false, "can_assign_requests": false },
  "iat": 1714000000,
  "exp": 1714003600
}
```

Где `subject_type ∈ { resident, staff, contractor_user }`.

Для `staff` — `role` = `security|concierge|technician|property_admin`; `capabilities` — snapshot текущих флагов.
Для `resident` — `role` всегда `resident`; `capabilities` не используется (пустой объект).
Для `contractor_user` — `role` всегда `contractor`; `capabilities` не используется.

---

## 3. Middleware

`backend/src/v1/middleware/authV1.js`:

```js
async function requireAuthV1(req, res, next) {
  const token = extractToken(req); // из cookie или Authorization header
  const claims = jwt.verify(token, JWT_SECRET);
  
  if (!claims.subject_type) {
    // Legacy token — fallback в legacy middleware
    return require('../../middleware/auth')(req, res, next);
  }
  
  const subject = await resolveSubject(claims.subject_type, claims.subject_id);
  if (!subject || !subject.is_active) return res.status(401).end();
  
  req.subject = { type: claims.subject_type, ...subject };
  req.user = { uid: subject.id, role: claims.role, ...claims.capabilities }; // legacy compat
  next();
}
```

`resolveSubject` читает из `residents`, `staff_users` или `contractor_users` в зависимости от типа. Результат — объект с полями, специфичными для роли.

---

## 4. Coexistence strategy

1. **До Фазы 7:** legacy middleware (`requireAuth`) активен. Он знает только legacy claims. Новые v1-роуты используют `requireAuthV1`, которая понимает ОБА формата (legacy fallback).
2. **В Фазе 7 (go-live):** при логине Замоскворечья выдаётся уже новый формат токенов; legacy `users` становится read-only view.
3. **Post go-live:** через 24 часа (рефреш) все активные сессии в новом формате. Legacy middleware можно удалить через 30 дней.

---

## 5. Login flow v1

Резидент — по phone + OTP (как в legacy):
```
POST /api/v1/auth/otp/send    { phone }
POST /api/v1/auth/otp/verify  { phone, code } → JWT { subject_type: 'resident' }
```

Staff — по email + password:
```
POST /api/v1/auth/staff/login { email, password } → JWT { subject_type: 'staff', role, capabilities }
```

Contractor — по phone + OTP (упрощённо, как резидент):
```
POST /api/v1/auth/contractor/login { phone, code } → JWT { subject_type: 'contractor_user' }
```

Email+password для резидентов **не вводим**. Phone+OTP для staff — **не вводим**. Разные identity проводят через разные каналы и дают разные пользовательские experience.

---

## 6. Acceptance criteria

- [ ] JWT claims содержат `subject_type`, `subject_id`, `property_id`
- [ ] `requireAuthV1` парсит оба формата (legacy fallback)
- [ ] Staff-login валидирует email + password через bcrypt (hashes — пока в отдельной таблице `staff_credentials`, which мы не делаем в Фазе 2; staff login в Фазе 2 = TODO, см. §7)
- [ ] Revoked tokens проверяются через существующую Redis blacklist
- [ ] `req.subject.is_active=false` → 401 даже при валидной подписи

---

## 7. Scope Фазы 2 (что реально делаем сейчас)

**Делаем:**
- Только миграции + routes для `staff_users` / `contractor_companies` / `contractor_users` (CRUD через property_admin).
- Middleware `requireAuthV1` — **не** пишем в Фазе 2. Используем legacy `requireAuth` для защиты v1-роутов: `property_admin` резолвится через legacy `role='admin'`.

**Не делаем:**
- Новые login-flows (staff password, contractor OTP) — это Фаза 3+ или Фаза 7.
- `staff_credentials` таблица — пост-релиз, когда нужен реальный login для персонала.

Причина: scope Фазы 2 — **структурный**, не behavioral. Мы готовим схему и CRUD, но продолжаем использовать legacy auth для защиты endpoint'ов.

---

## 8. Открытые вопросы

1. **2FA для property_admin** → **Пост-релиз.** Сейчас property_admin — любой staff с `role='property_admin'`, auth через ту же legacy-схему.
2. **OIDC/SAML для enterprise-УК** → **P2-P3.** Будет через federated identity, отдельный spec.
3. **Сессия между tenant'ами** (один человек — admin на двух ЖК) → **v1 не поддерживает.** Один JWT = один property. Multi-property dashboard — вне scope D-lite.
