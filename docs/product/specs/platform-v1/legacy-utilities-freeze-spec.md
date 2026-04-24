# Module Spec — `legacy_utilities_enabled` (platform-v1, Phase 6 P4)

**Фаза:** 6 (legacy-freeze)
**Статус:** Draft (2026-04-24) — блокирует go-live Замоскворечья
**Связано:** `ROADMAP.md` §«Фаза 6» решение `Вариант B`; `RECONCILIATION.md §12`
**Схема-база:** `FEATURE_FLAGS` registry в `backend/src/config/featureFlags.js`
**Существующий код (до P4):** per-module флаги (`meter_readings`, `billing`, `space_booking`) уже default=false, но `chat` был `locked: true + default: true`, а все четыре ручки не имели согласованного platform-level freeze'а.

---

## 1. Назначение

`legacy_utilities_enabled` — **агрегирующий freeze-флаг** для четырёх legacy-модулей, которые по roadmap откладываются на пост-релиз:

| Модуль | Таблицы | Endpoint |
|---|---|---|
| Показания счётчиков | `meter_readings` | `/api/v1/meter-readings/*` |
| Биллинг | `billing_records` | `/api/v1/billing/*` |
| Бронирования | `spaces`, `space_bookings` | `/api/v1/spaces/*`, `/api/v1/bookings/*` |
| Чат жильцов | `chat_messages` | `/api/v1/chat/*`, `/api/chat/*` (legacy-префикс) |

**Что меняется:**
- Один дополнительный layer middleware `requireFeature('legacy_utilities_enabled')` применяется поверх уже существующих per-module `requireFeature`.  Порядок: `legacyUtilitiesGate → per-module gate → router`.
- Для Замоскворечья флаг `false` на старте → endpoint возвращает `404 FEATURE_DISABLED`.
- Когда УК добавит отдельный спринт на разморозку (BACKLOG `«Архитектурные улучшения»`), admin перещёлкнет флаг в `true` через `PATCH /api/v1/admin/feature-flags` — и тогда уже per-module флаги решают, какие конкретно модули активны на property.

**Что НЕ меняется:**
- Существующие per-module флаги (`meter_readings`, `billing`, `space_booking`, `chat`) остаются в регистре с прежними дефолтами и семантикой.  Они — второй слой (granular).
- Код routers/services этих модулей не трогается — это исключительно freeze на уровне маршрутизации.
- Миграции БД не пишутся — таблицы `meter_readings` / `billing_records` / etc. остаются в базе как есть.

---

## 2. Схема (registry-entry)

```js
// backend/src/config/featureFlags.js
legacy_utilities_enabled: {
  default: false,
  label: 'Устаревшие модули (legacy)',
  description: 'Разморозить показания, биллинг, бронирования и чат (временно, до пост-релиза)',
  category: 'admin',
},
```

**Почему default=false:** первый tenant (Замоскворечье) — премиум-объект, бизнес-юзер-стори «я подаю показания через dash» не входит в v1 scope.  Оставлять ручки открытыми означает, что frontend резидента покажет таб счётчиков на основе `/feature-flags` (где `meter_readings: false`), но если кто-то достанет URL напрямую — получит 500/неопределённое поведение со старого кода.  Freeze-gate даёт чистый `404 FEATURE_DISABLED`.

**Почему не `locked: true`:** locked означает «админ не может переключить».  Для freeze-гейта это избыточно: мы планируем разморозку в пост-релизе, и каждая УК должна иметь возможность включить её сама после своего спринта на миграцию данных.

---

## 3. Middleware chain

```js
// backend/src/app/registerApiRoutes.js
const legacyUtilitiesGate = requireFeature('legacy_utilities_enabled');

app.use('/api/v1/chat',           legacyUtilitiesGate, chatRouter);
app.use('/api/v1/meter-readings', legacyUtilitiesGate, requireFeature('meter_readings'), meterReadingsRouter);
app.use('/api/v1/billing',        legacyUtilitiesGate, requireFeature('billing'),        billingRouter);
app.use('/api/v1/spaces',         legacyUtilitiesGate, requireFeature('space_booking'),  spacesRouter);
app.use('/api/v1/bookings',       legacyUtilitiesGate, requireFeature('space_booking'),  bookingsRouter);
app.use('/api/v1',                legacyUtilitiesGate, bookingsRouter); // root mount for /spaces/:spaceId/bookings
app.use('/api/chat',              deprecate, legacyUtilitiesGate, chatRouter);
```

**Ответы endpoint'а:**

| Состояние flag'ов | Ответ |
|---|---|
| `legacy_utilities_enabled=false` | `404 { error: { code: 'FEATURE_DISABLED', message: "Функция 'legacy_utilities_enabled' не подключена..." } }` |
| `legacy_utilities_enabled=true, meter_readings=false` | `404 { error: { code: 'FEATURE_DISABLED', message: "Функция 'meter_readings' не подключена..." } }` (для meter-readings эндпоинта) |
| `legacy_utilities_enabled=true, meter_readings=true` | route выполняется |
| property-context отсутствует (platform endpoints) | middleware пропускает (`req.property == null`) |

---

## 4. Миграция state'а Замоскворечья

При создании property через `POST /platform/api/v1/properties` — `feature_flags` сохраняется пустым JSONB, значит `resolveFlags` возвратит `legacy_utilities_enabled: false` (registry default).  Ничего специально делать не надо.

При последующем `PATCH /api/v1/admin/feature-flags` admin может:
- оставить `legacy_utilities_enabled: false` → все четыре ручки закрыты;
- выставить в `true` → per-module флаги решают, какие конкретно модули на этом property активны.

---

## 5. Acceptance criteria

1. **Flag в регистре:** `FEATURE_FLAGS.legacy_utilities_enabled.default === false`, label/description непустые, не `locked`.
2. **Middleware-поведение:** `requireFeature('legacy_utilities_enabled')` возвращает 404 FEATURE_DISABLED при `flags.legacy_utilities_enabled === false`; `next()` при `true`; `next()` при отсутствии property-контекста.
3. **Wiring:** все seven app.use лайнов в registerApiRoutes.js содержат `legacyUtilitiesGate` в middleware-цепочке (см. §3).  Smoke-тест в `v1LegacyUtilitiesFrozen.test.js` проверяет исходник.
4. **Frontend `FEATURE_KEYS`:** обновлён — `legacy_utilities_enabled` добавлен в конец tuple (иначе `featureFlagsRegistry.test.js §backend ↔ frontend key contract` упадёт).
5. **Backend suite:** 1710+/1710+ зелёных после refactor'а (никаких регрессий в существующих chat/meters/billing тестах — они не бьют endpoint'ы, используют сервисный слой напрямую).

---

## 6. Open questions (резолюция)

- **Q1:** Нужно ли на frontend скрывать таб «Счётчики»/«Чат» когда `legacy_utilities_enabled=false`?
  - **A:** Не в P4.  Frontend уже зависит от per-module флагов (`meter_readings`, `chat`, etc.).  `useFeatureFlag('chat')` вернёт `true` (locked-default), но ручка запечатана на backend'е.  В P5 (frontend cleanup, если войдёт в go-live scope) — можно добавить проверку `legacy_utilities_enabled && meter_readings` в `<ResidentTabs>`.  Пока — минимальное изменение.

- **Q2:** Что с `chat`-флагом — он остался `locked: true + default: true`, то есть admin не может его выключить.  Это не противоречит freeze?
  - **A:** Не противоречит.  `chat: true` резолвится как «на concept-уровне функция активна», но endpoint всё равно закрыт через `legacy_utilities_enabled`.  После разморозки (legacy_utilities_enabled=true) chat будет работать автоматически.  Сохранили `locked` чтобы не падал существующий тест `resolveFlags ignores stored overrides for locked flags` (единственный locked-flag).

- **Q3:** А `packages` / `announcements` / `documents` разве не legacy?
  - **A:** Они мигрированы в `v1/` (Phase 5) и первокласcные в roadmap — под `packages_v2`, `announcements_v2`, `documents_v2`.  Legacy-версии этих routers остались как fallback, но v1-ручки — то, что мы деплоим.  Freeze на них не нужен.

---

## 7. Post-P4 backlog

Явно не в scope Phase 6 P4:

- [ ] `legacy_utilities_enabled` в `platform_audit_log` — каждый toggle admin'а пишется в audit.  Работает через существующий `property.feature_flags_updated` event (см. `adminSettings.js`).
- [ ] Admin UI badge «Legacy» в категории «Администрирование» — визуальный hint, что флаг разблокирует осторожно.  Можно не делать — description уже объясняет.
- [ ] Discoverability: CLI-команда `node scripts/print-frozen.js` для ops — «какие property с `legacy_utilities_enabled=true`».  В v1 handled вручную через SQL к platform DB.
