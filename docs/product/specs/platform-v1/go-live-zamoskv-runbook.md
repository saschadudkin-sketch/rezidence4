# Go-Live Runbook — Резиденции Замоскворечья

**Фаза:** 7 (ROADMAP.md) — первый production tenant
**Статус:** Draft (2026-04-24) — runbook к деплою, доработать после dry-run
**Предусловия:** Phase 6 P1–P4 закрыты (authz + notification templates + legacy freeze)
**Целевой ветки:** `platform-v1` (будет промерджена в `main` после успешного go-live)
**Владелец:** Александр (owner)

---

## 1. Preflight-чеклист (T-7 дней до go-live)

Всё ниже — **локально на dev-машине**, прежде чем логиниться на сервер.

### 1.1 Код готов

- [ ] `git checkout platform-v1 && git pull --ff-only` — ветка актуальна.
- [ ] `cd backend && npx jest --no-coverage` → **все suites зелёные** (ожидается 1725+).
- [ ] `cd backend && npx eslint src` → 0 ошибок.
- [ ] `cd frontend && npm run build` → bundle собирается.
- [ ] `cd frontend && npx tsc --noEmit` → 0 новых ошибок (pre-existing в `VisitLogView.test.tsx` и тестах без vitest types — игнорировать, не блокирует).
- [ ] Версия тэгнута: `git tag -a v1.0.0-zamoskv -m "Go-live Zamoskvorechye"`.

### 1.2 Секреты подготовлены

```bash
# Три отдельных 256-битных секрета:
openssl rand -hex 32  # JWT_SECRET
openssl rand -hex 32  # PLATFORM_JWT_SECRET
openssl rand -hex 32  # UPLOAD_SIGNING_SECRET
openssl rand -hex 24  # REDIS_PASSWORD
openssl rand -hex 24  # DB_PASSWORD
```

Сохранить в менеджере паролей УК (не в git). Никогда не переиспользовать JWT_SECRET как PLATFORM_JWT_SECRET — компрометация одного не должна давать доступ к superadmin.

### 1.3 Web Push VAPID ключи

```bash
cd backend
node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey);console.log('VAPID_PRIVATE_KEY='+k.privateKey)"
```

Сохранить. Публичный ключ попадёт в frontend bundle при сборке.

### 1.4 DNS

- [ ] Приобретён / подтверждён домен `domhub.su` (или выбранный).
- [ ] A-record `zamoskv.domhub.su → SERVER_IP` создан **за 24 часа** до deploy (DNS propagation).
- [ ] A-record `admin.domhub.su → SERVER_IP` (для superadmin SPA) — опционально, можно на том же хосте через path.
- [ ] Проверка: `dig +short zamoskv.domhub.su` возвращает правильный IP.

### 1.5 Сервер готов

- [ ] VPS выделен (Timeweb, 4GB RAM / 30GB disk / Ubuntu 22.04 LTS или 24.04).
- [ ] SSH-доступ root работает.
- [ ] `DEPLOY.md §1–§2` выполнен (apt update, ufw, Docker).

---

## 2. Deploy (T-1 день)

### 2.1 Подготовка директории

```bash
ssh root@SERVER_IP
mkdir -p /var/www/domhub
cd /var/www/domhub
git clone REPO_URL .
git checkout v1.0.0-zamoskv   # тэг из §1.1
```

### 2.2 `.env` (единый, корневой)

```bash
cp .env.example .env
nano .env
```

Заполнить **обязательные** поля из секретов §1.2 и §1.3. Критично:

```env
NODE_ENV=production
DATABASE_URL=postgresql://residenze:DB_PASSWORD@db:5432/residenze
PLATFORM_DB_URL=postgresql://residenze:DB_PASSWORD@db:5432/platform
ZAMOSKV_DB_URL=postgresql://residenze:DB_PASSWORD@db:5432/zamoskv
ZAMOSKV_HOSTNAME=zamoskv.domhub.su
JWT_SECRET=<openssl rand -hex 32>
PLATFORM_JWT_SECRET=<openssl rand -hex 32>
UPLOAD_SIGNING_SECRET=<openssl rand -hex 32>
REDIS_URL=redis://:REDIS_PASSWORD@redis:6379
FRONTEND_URL=https://zamoskv.domhub.su
BACKEND_URL=https://zamoskv.domhub.su
VAPID_PUBLIC_KEY=<из §1.3>
VAPID_PRIVATE_KEY=<из §1.3>
VAPID_SUBJECT=mailto:admin@zamoskv.ru
SMSRU_API_ID=STUB            # переключить на реальный после smoke-теста
CONTACT_EMAIL=admin@zamoskv.ru
```

### 2.3 Создание трёх БД на Postgres

Platform-v1 требует **трёх** логических БД:
- `residenze` — legacy monolith (остаётся для совместимости)
- `platform` — реестр properties + УК + superadmin
- `zamoskv` — per-property данные Замоскворечья

```bash
docker compose up -d db redis
docker compose exec db psql -U residenze -d residenze -c "\
  CREATE DATABASE platform OWNER residenze; \
  CREATE DATABASE zamoskv  OWNER residenze;"
```

### 2.4 Миграции

```bash
docker compose up -d --build backend
docker compose exec backend node src/migrate.js
```

Ожидается:
- Platform миграции (`001_properties_full_spec … 006_platform_audit_log`) применяются на `platform` DB.
- Per-property миграции (v1_001 … v1_022) применяются на `zamoskv` DB.
- Seed property `zamoskv` создаётся в `platform.properties` автоматически из `ZAMOSKV_DB_URL` + `ZAMOSKV_HOSTNAME` (см. `platformMigrations.js` §001).

**Sanity:**
```bash
docker compose exec db psql -U residenze -d platform -c "SELECT slug, hostname, is_active FROM properties;"
# Ожидается: zamoskv | zamoskv.domhub.su | t
docker compose exec db psql -U residenze -d zamoskv -c "SELECT id FROM v1_property_migrations ORDER BY id;"
# Ожидается: 22 строки v1_001..v1_022
```

### 2.5 Запуск стека

```bash
docker compose up -d --build
docker compose ps
```

Все сервисы `Up`/`healthy`: `db`, `redis`, `backend`, `frontend`, `backup`.

### 2.6 HTTPS через Let's Encrypt

Следуя `DEPLOY.md §8`:

```bash
docker compose stop frontend
docker run --rm -p 80:80 \
  -v /etc/letsencrypt:/etc/letsencrypt \
  -v /var/www/certbot:/var/www/certbot \
  certbot/certbot certonly --standalone \
  -d zamoskv.domhub.su

# .env: ENABLE_HTTPS=true уже стоит
docker compose up -d --build
curl -I https://zamoskv.domhub.su
curl https://zamoskv.domhub.su/api/health
```

---

## 3. Seed данных УК + администратора

### 3.1 Создать management company и первого superadmin'а

```bash
docker compose exec db psql -U residenze -d platform <<'SQL'
INSERT INTO management_companies (id, slug, name, contact_email, is_active)
VALUES (gen_random_uuid(), 'rezidentsii-zamoskvorechya',
        'УК Резиденции Замоскворечья', 'admin@zamoskv.ru', true)
ON CONFLICT (slug) DO NOTHING
RETURNING id;

-- Подставить ID из RETURNING в следующий запрос:
UPDATE properties
   SET management_company_id = '<ID_ИЗ_ВЫВОДА_ВЫШЕ>'
 WHERE slug = 'zamoskv';
SQL
```

### 3.2 Первый platform-admin (superadmin SPA)

**Схема `platform_admins`** (см. `backend/src/platformMigrations.js:30-39`): `id, email,
password_hash, name, is_active, last_login_at, created_at`. Колонки `role` нет —
все админы в этой таблице имеют superadmin-доступ по определению (разграничение
доступа — через `management_company_admins` в миграции 005).

Генерируем случайный пароль и хешируем:

```bash
# Генерация случайного пароля — НЕ использовать фиксированный литерал в runbook'е.
INITIAL_PW=$(openssl rand -base64 24)
echo "Initial superadmin password: $INITIAL_PW"   # запомнить и убрать из истории

docker compose exec -T backend node -e "
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PLATFORM_DB_URL });
(async () => {
  const pw = process.env.INITIAL_PW;
  if (!pw) throw new Error('INITIAL_PW env missing');
  const hash = await bcrypt.hash(pw, 12);
  await pool.query(\`
    INSERT INTO platform_admins (email, password_hash, name, is_active)
    VALUES (\$1, \$2, \$3, true)
    ON CONFLICT (email) DO NOTHING
  \`, ['admin@domhub.su', hash, 'Platform Superadmin']);
  console.log('superadmin seeded');
  await pool.end();
})();
" -e "process.env.INITIAL_PW = '$INITIAL_PW'"
```

Логин: `admin@domhub.su` / пароль из переменной `$INITIAL_PW` → **немедленно сменить** через superadmin SPA (`/platform/settings`).

После смены пароля — очистить `$INITIAL_PW` из shell history:
```bash
unset INITIAL_PW && history -d $(history | tail -n 2 | head -n 1 | awk '{print $1}')
```

### 3.3 Первый property-admin (per-tenant)

После логина в superadmin SPA на `https://admin.domhub.su` (или через path `/platform` на основном хосте):
1. Открыть **Properties → Замоскворечье**.
2. Нажать **«Создать property-admin»**, указать телефон и имя.
3. Система отправит OTP-код (в stub-режиме — в логи backend'а).

Либо через SQL прямо в `zamoskv.users`:
```bash
docker compose exec db psql -U residenze -d zamoskv -c "\
  INSERT INTO users (id, phone, name, role, is_active) VALUES (\
    gen_random_uuid(), '+79991234567', 'Иван Петров', 'admin', true);"
```

### 3.4 Feature-flags для Замоскворечья

**Default state** (registry defaults, см. `featureFlags.js`):
- `chat=true, locked` (но endpoint закрыт через `legacy_utilities_enabled`)
- `announcements=false`, `documents=false`, `qr_pass=false`, `packages=false`, `meter_readings=false`, `billing=false`, `space_booking=false`
- `legacy_utilities_enabled=false` (P4 freeze) → meters/billing/bookings/chat возвращают 404

**Для go-live Замоскворечья** включить только то, что реально в scope:
```bash
docker compose exec backend node -e "
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.PLATFORM_DB_URL });
pool.query(\`
  UPDATE properties
     SET feature_flags = feature_flags || \$1::jsonb,
         updated_at = NOW()
   WHERE slug = 'zamoskv'
\`, [JSON.stringify({
  announcements: true,
  documents: true,
  qr_pass: true,
  packages: true,
})]).then(() => { console.log('flags set'); pool.end(); });
"
```

**НЕ** включать на go-live: `meter_readings`, `billing`, `space_booking`, `legacy_utilities_enabled`. Эти модули замороженны по roadmap §Фаза 6 P4 — разморозка в пост-релизе.

### 3.5 Sanity: GET /api/v1/admin/feature-flags

```bash
# Auth через property-admin token (получить через LoginView → OTP)
curl -s -H "Cookie: $COOKIE" https://zamoskv.domhub.su/api/v1/admin/feature-flags | jq
```

Ожидаемые значения:
```json
{
  "chat": true, "announcements": true, "documents": true,
  "qr_pass": true, "packages": true,
  "meter_readings": false, "billing": false, "space_booking": false,
  "legacy_utilities_enabled": false, ...
}
```

---

## 4. Smoke-тест (полный access-lifecycle)

Перед публичным анонсом — через браузер на `https://zamoskv.domhub.su`.

1. **Login admin** — получить OTP из `docker compose logs backend | grep STUB`, залогиниться.
2. **Создать резидента** — `/admin/users` → «Новый резидент», указать телефон, unit, роль=owner.
3. **Резидент логинится** на своём устройстве, открывает dashboard.
4. **Резидент создаёт пропуск** — `/passes` → «Пригласить гостя», указать имя + время.
5. **Admin видит pending-request** в `/admin/requests`, одобряет → резидент получает web-push.
6. **Охрана сканирует QR** гостя через `/security` — должно зелёное «Пропуск активен».
7. **Resident объявление** — `/board`, admin публикует → все резиденты получают web-push + email.
8. **Посылка** — concierge создаёт `/admin/packages/new`, резидент получает push, затем «Забрал» — статус меняется.
9. **Frozen endpoints возвращают 404** — `curl https://zamoskv.domhub.su/api/v1/meter-readings → 404 FEATURE_DISABLED`, аналогично `/billing`, `/bookings`, `/chat`.

Если любой из шагов фейлит — в логи backend'а (`docker compose logs backend --tail 200`), решение до DNS cutover.

---

## 5. DNS cutover + публикация

Если smoke-тест зелёный:

1. Уведомить УК, что система доступна по `zamoskv.domhub.su`.
2. Раздать резидентам ссылку + PIN-коды первичной регистрации (см. LoginView docs).
3. Мониторить первые 48 часов:
   - `docker compose logs backend -f | grep -i error`
   - `curl https://zamoskv.domhub.su/api/health`
   - Sentry (если подключен): errors > 0 = триаж.
4. После 72h безаварийной работы — перевести `SMSRU_API_ID` с `STUB` на реальный, перезапустить backend.

---

## 6. Rollback plan

Если в первые часы после публикации обнаружены P0-баги:

1. **DNS не откатываем** — резиденты уже кэшировали A-record.
2. `git checkout PREVIOUS_GOOD_TAG && docker compose up -d --build` — код откатывается, volumes и DB сохраняются.
3. Если нужен **data rollback** — восстановить из `./backups/zamoskv-latest.dump` (есть ежедневный snapshot через `backup` контейнер).
4. На админ-панели — отключить модули через feature-flags, чтобы изолировать проблемную фичу без полного отката:
   ```bash
   docker compose exec backend node -e "
     const { Pool } = require('pg');
     new Pool({ connectionString: process.env.PLATFORM_DB_URL }).query(
       \"UPDATE properties SET feature_flags = feature_flags - 'packages' WHERE slug='zamoskv'\"
     ).then(() => process.exit(0))"
   ```

---

## 7. Post-launch (недели 11–14)

Отдельный pipeline, не в этом runbook'е — см. `BACKLOG.md §P1`.

Ключевое:
- Мониторинг (Grafana/Prometheus) поднять к неделе 11 — метрики `outbox_*` уже пишутся.
- Onboarding wizard для второй УК (BACKLOG P0-3) — пока вторая УК не подошла, seed через SQL — OK.
- Разморозка legacy utilities (meters/billing) — по отдельному спринту с миграцией legacy данных.
- Публикация roadmap для v2 (native mobile, SKUD integration, billing).

---

## 8. Open questions (резолюция)

- **Q1:** Что если VAPID-ключи потеряны между deploy и scaling?
  - **A:** Все подписки web-push в БД станут недействительны. Процедура: сгенерировать новые ключи, залить в `.env`, перезапустить backend, **отправить всем резидентам push-реопт через telegram/email** с призывом «включить уведомления заново». Потерянные ключи — аналог перестановки приложения.

- **Q2:** Нужен ли backup platform DB отдельно от property DB?
  - **A:** Да. `docker-compose.yml` → `backup` контейнер сейчас делает `pg_dump residenze`; нужно добавить ещё два запуска для `platform` и `zamoskv`. Либо один raw-dump `pg_dumpall`. Зафиксировать как P0-задачу в `BACKLOG.md` после first-deploy dry run.

- **Q3:** Что с legacy rezidence4 БД — мигрируем её данные?
  - **A:** На pre-deployment стадии (реальных клиентов нет) — **не мигрируем**. `ROADMAP.md §Фаза 7` ставит «Архивировать legacy/zamoskvoreche-v0» как последний шаг: dump старой БД + tag ветки, новая Замоскворечье стартует с нуля.

---

## 9. Контакты (incident response)

| Роль | Кто | Канал |
|---|---|---|
| Owner | Александр | — |
| On-call SRE | TBD (пока — Александр) | email |
| УК Замоскворечья | admin@zamoskv.ru | OTP SMS |
| Timeweb support | — | ticket |

SLA (до найма команды) — best effort, 8×5. Формальный 24×7 SLA — после подключения второй УК.
