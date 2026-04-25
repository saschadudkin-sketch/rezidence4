# DomHub — Production Deployment Guide

Гайд по развёртыванию платформы DomHub на VPS (Timeweb / любой Linux сервер с Docker Engine).

Эта папка содержит **только то, что нужно для prod-деплоя**: документацию, env-template и bundle-скрипт. Реальный код берётся из основного репозитория через `git clone` или предсобранный bundle.

---

## Что НЕ нужно в production

Не копируйте на prod-сервер вручную:

- ❌ `ops/ci-dummy.env` — CI-only fake creds (если попадёт как `.env` → security compromise)
- ❌ `backend/src/__tests__/` — тесты (исключаются через `.dockerignore`)
- ❌ `frontend/e2e/` — Playwright тесты
- ❌ `.github/workflows/` — CI конфиги
- ❌ `docs/`, `BACKLOG.md`, `ROADMAP.md`, `CLAUDE.md` — meta-документы
- ❌ `loadtest/` — k6 нагрузочные скрипты
- ❌ `.claude/` — agent конфиги
- ❌ `scripts/ci/` — CI utilities

Всё это либо исключено через `.dockerignore` (не попадает в Docker images), либо просто не используется runtime'ом.

---

## Что НУЖНО в production

| Файл/папка | Назначение |
|------------|-----------|
| `docker-compose.yml` | оркестрация |
| `backend/Dockerfile` + `backend/src/` (без `__tests__`) + `backend/package*.json` | backend image |
| `frontend/Dockerfile` + `frontend/src/` + `frontend/package*.json` | frontend image |
| `frontend/nginx.conf` (или подобный) | reverse-proxy config |
| `ops/db-init/` | postgres init scripts (создают `platform`/`zamoskv` databases) |
| `ops/alerts/` | Prometheus alerting rules (если monitoring настроен) |
| `.env` | **production secrets** (создаётся вручную, см. ниже) |

---

## Шаги развёртывания

### 1. Подготовка VPS

```bash
ssh deploy@your-vps.timeweb.ru

# Установить Docker (Ubuntu 22.04+):
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Logout + login для применения групп
```

### 2. Получить код

**Вариант A — git clone (рекомендуется для CI/CD):**
```bash
sudo mkdir -p /opt/domhub
sudo chown $USER /opt/domhub
cd /opt/domhub
git clone https://github.com/saschadudkin-sketch/rezidence4.git .
```

**Вариант B — bundle (для одиночного деплоя без git):**
На локальной машине:
```bash
cd D:/rezidence4
bash deploy/bundle.sh           # создаёт deploy/bundle-YYYYMMDD-HHMM.tar.gz
scp deploy/bundle-*.tar.gz deploy@vps:/opt/domhub/
```
На VPS:
```bash
cd /opt/domhub
tar -xzf bundle-*.tar.gz
rm bundle-*.tar.gz
```

### 3. Создать `.env` с production секретами

⚠️ **НЕ копируйте `ops/ci-dummy.env` или `.env.example` напрямую.** Используйте `deploy/.env.production.template` как основу:

```bash
cp deploy/.env.production.template .env
chmod 600 .env

# Сгенерировать secrets:
sed -i "s|^DB_PASSWORD=.*|DB_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=$(openssl rand -hex 24)|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^PLATFORM_JWT_SECRET=.*|PLATFORM_JWT_SECRET=$(openssl rand -hex 32)|" .env
sed -i "s|^UPLOAD_SIGNING_SECRET=.*|UPLOAD_SIGNING_SECRET=$(openssl rand -hex 32)|" .env

# Заполнить остальное вручную:
nano .env
# YOUR_DOMAIN=domhub.app
# FRONTEND_URL=https://domhub.app
# SMSRU_API_ID=<реальный sms.ru API ID>
# VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY (web-push)
# SENTRY_DSN (если используется)
```

### 4. Pre-flight check

```bash
bash deploy/check-config.sh
```

Скрипт проверит, что:
- ✓ `.env` существует и `chmod 600`
- ✓ Все required vars заполнены не dummy values
- ✓ JWT_SECRET ≠ PLATFORM_JWT_SECRET и оба ≥32 chars
- ✓ DATABASE_URL имеет `sslmode=require` (если SSL включен)
- ✓ NODE_ENV=production
- ✓ Docker daemon доступен

### 5. Запустить stack

```bash
docker compose up -d
docker compose logs -f backend  # дождаться startup, миграции, health green
```

При первом старте postgres автоматически создаст `platform` и `zamoskv` databases (через `ops/db-init/01-create-platform-databases.sh`).

### 6. SSL (Let's Encrypt)

```bash
# Если используется nginx + Certbot снаружи docker:
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d domhub.app
```

Или встроенный SSL через Caddy/Traefik — см. вашу инфраструктуру.

### 7. Загрузить начальные данные

```bash
# Создать первого superadmin'а:
docker compose exec -T db psql -U residenze -d platform <<SQL
INSERT INTO platform_admins (id, email, password_hash, name, is_active)
VALUES (gen_random_uuid(), 'admin@domhub.app', '<bcrypt-hash>', 'Admin', true);
SQL

# Создать первый property (Резиденции Замоскворечья):
docker compose exec -T db psql -U residenze -d platform <<SQL
INSERT INTO properties (slug, name, db_connection_url, status)
VALUES ('zamoskvorechye', 'Резиденции Замоскворечья',
        'postgresql://residenze:<DB_PASSWORD>@db:5432/zamoskv', 'active');
SQL
```

### 8. Smoke test

```bash
curl https://domhub.app/api/health
# {"ok":true}

curl -I https://domhub.app/
# HTTP/2 200 — frontend serves
```

---

## Apдeйт runtime

```bash
cd /opt/domhub
git pull origin main
docker compose pull         # если used pre-built images
docker compose up -d --build
docker compose logs -f backend
```

`docker compose up -d --build` пересобирает images если код изменился, и запускает контейнеры по новой версии. Postgres data persistent (`db_data` named volume), не теряется.

---

## Backup

```bash
# Backup container запущен автоматически (см. docker-compose.yml services.backup).
# Дамп сохраняется в named volume — настройте rsync/restic на S3.

docker compose exec backup ls -la /backup
# проверить даты последних дампов

# Manual backup:
docker compose exec -T db pg_dumpall -U residenze > backup-$(date +%Y%m%d).sql
```

---

## Troubleshooting

### Backend container crashes на startup

Симптом: `docker compose logs backend` показывает `[migrate] FAILED`.

**`011_multi_tenant_support` FK type mismatch** — известный pre-existing bug в migrations. Backend backlog item HIGH. Fix: backend team должен исправить тип столбца в migration.

Workaround для emergency deploy: если БД уже инициализирована до migration 011 (старая prod schema), миграция работает. Только на fresh DB упадёт.

### Health check fails

```bash
docker compose exec backend wget -qO- http://localhost:3001/api/health
# Должен вернуть {"ok":true}
```

Если timeout — проверить что postgres + redis healthy:
```bash
docker compose ps
docker compose logs db redis | tail -50
```

### CORS errors с frontend

В `.env`:
```
FRONTEND_URL=https://domhub.app  # точный URL без trailing slash
```

В backend prod CORS использует `FRONTEND_URL` для allow-list.

---

## Backlog (известные issue для backend team)

| Priority | Item |
|----------|------|
| **HIGH** | Fix migration `011_multi_tenant_support` — FK `push_subscriptions.user_id` UUID ↔ `users.uid` TEXT type mismatch |
| MEDIUM | L-2 Audit log: db.query → req.db (4 файла) — до onboarding'а 2-го property |
| MEDIUM | M-4 Admin JWT в localStorage → HttpOnly cookie — до 2-го property |
| LOW | L-1 Telegram bot token plaintext в DB → шифровать pgcrypto |

---

## Ссылки

- Repo: https://github.com/saschadudkin-sketch/rezidence4
- Issues: https://github.com/saschadudkin-sketch/rezidence4/issues
- Spec: `docs/product/specs/platform-v1/`
