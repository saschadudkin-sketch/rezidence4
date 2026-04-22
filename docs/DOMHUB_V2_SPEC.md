# DomHub v2.0 — Technical Specification

**Status:** Authoritative — all implementing agents must treat this as the source of truth.  
**Date:** 2026-04-18  
**Codebase root:** `D:/rezidence4/.claude/worktrees/vigorous-cray-98c989`

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current v1 Architecture Baseline](#2-current-v1-architecture-baseline)
3. [Phase 0 — Multi-Tenant Infrastructure](#3-phase-0--multi-tenant-infrastructure)
4. [Phase 0.5 — DomHub Design System](#4-phase-05--domhub-design-system)
5. [Phase 1 — Push Notifications](#5-phase-1--push-notifications)
6. [Phase 2 — Announcements, Documents, QR Pass](#6-phase-2--announcements-documents-qr-pass)
7. [Phase 3 — Resident Dashboard Expansion](#7-phase-3--resident-dashboard-expansion)
8. [Phase 4 — Concierge & Requests](#8-phase-4--concierge--requests)
9. [Phase 5 — Webhook Engine & Integrations](#9-phase-5--webhook-engine--integrations)
10. [Phase 6 — Analytics](#10-phase-6--analytics)
11. [ФЗ-152 Compliance](#11-фз-152-compliance)
12. [Timeweb Deployment](#12-timeweb-deployment)
13. [API Versioning Strategy](#13-api-versioning-strategy)
14. [Migration Strategy v1 → v2](#14-migration-strategy-v1--v2)
15. [Technology Choices Rationale](#15-technology-choices-rationale)
16. [Cross-Phase Constraints](#16-cross-phase-constraints)

---

## 1. Executive Summary

DomHub v2.0 transforms the existing single-property Rezidentsii Zamoskvorech'ya application into a premium multi-tenant SaaS platform for managing residential complexes in Russia. The v1 system is a well-structured Node.js/Express API with a React/Vite PWA frontend. All multi-tenant scaffolding (`platformMigrations.js`, `propertyDb.js`, `PLATFORM_DB_URL`, `PLATFORM_JWT_SECRET`, `getPlatformDb()`) is already present in the codebase as of migration `011_multi_tenant_support`. Phase 0 formalises and completes that infrastructure.

The upgrade is strictly additive: no existing `/api/v1/*` endpoints are removed, no database columns are dropped, no client behavior is broken. Each phase is independently shippable.

---

## 2. Current v1 Architecture Baseline

### 2.1 Backend Stack

- **Runtime:** Node.js (Express 5.x)
- **Database:** PostgreSQL 16 via `pg` pool (`max: 20`, `statement_timeout: 10s`)
- **Cache / Pub-Sub:** Redis 7 via `ioredis` singleton (`lib/redisClient.js`)
- **Real-time:** Server-Sent Events (in-process `Map<uid, Set<{res, role}>>`), with a documented TODO to move to Redis Pub/Sub for horizontal scale
- **Auth:** OTP via sms.ru → JWT access token (15 min, HttpOnly cookie) + refresh token (30 days, hashed SHA-256 in `refresh_tokens` table), token revocation in Redis with DB fallback
- **Uploads:** local filesystem, HMAC-signed URLs, `upload_objects` audit table
- **SMS:** `services/smsService.js` with primary sms.ru + configurable fallback key
- **Observability:** pino structured logging, Prometheus-format `/api/metrics/prometheus`, Sentry integration, `/api/health` + `/health`
- **Background jobs:** `server/runtimeJobs.js` — token cleanup (1h), request expiration (5 min), OTP cleanup (5 min)
- **Security:** Helmet CSP, CORS allowlist, CSRF double-submit cookie, rate limiters (auth 5/min, global, upload, SSE), idempotency middleware (Redis + in-memory fallback)

### 2.2 Database Schema (v1 migrations 001–011)

Core tables: `users`, `otp_codes`, `requests`, `request_history`, `chat_messages`, `perms`, `templates`, `blacklist`, `visit_logs`, `token_revocations`, `refresh_tokens`, `sse_clients`, `upload_objects`, `upload_access_audit`.

Migration 011 adds: `push_subscriptions`, `announcements`, `documents` (Phase 1/2 prep skeletons), plus `users.property_slug VARCHAR(50)`.

### 2.3 Platform Database (already in code)

`platformMigrations.js` migration `001_platform_registry` creates:
- `properties (id, slug, name, address, db_connection_url, is_active, plan, timezone, contact_email, contact_phone, created_at, updated_at)`
- `platform_admins (id, email, password_hash, name, is_active, last_login_at, created_at)`
- `platform_audit_log (id, admin_id, action, property_id, details, ip_address, created_at)`

Seeded: `zamoskv` → current `DATABASE_URL` as `db_connection_url`.

### 2.4 Multi-Tenant Request Router (already in code)

`middleware/propertyDb.js`:
- Reads `X-Property-Slug` header first, falls back to `property_slug` claim in JWT
- Looks up connection URL in platform DB (in-memory cache, TTL 60s)
- Creates/reuses a `pg.Pool` per slug (stored in module-level `Map`)
- Attaches `req.db`, `req.property`, `req.propertySlug` to every request
- Returns `400` if no slug, `404` if slug unknown, `503` if `is_active = false`

### 2.5 Frontend Stack

- **Framework:** React 18 + TypeScript, Vite
- **Routing:** React Router v6
- **State:** Context API + `useReducer` (SSE-driven slices), React Query for one-shot reads
- **CSS:** Three-layer architecture — `tokens.css` (custom properties), `foundations.css` (reset + keyframes), `theme.css` (component classes)
- **Design tokens:** Dark-first. `--s0: #11100e` bg, `--g2: #c9a96e` gold accent, `--t1: #eee7dc` warm white text. Light theme via `html.theme-light` class. Font: `'Aptos', 'Segoe UI Variable Text', sans-serif`.
- **PWA:** Workbox service worker, offline-first
- **Roles:** `owner`, `tenant`, `contractor`, `concierge`, `security`, `admin`

### 2.6 Deployment

Single Docker Compose stack on Timeweb VPS: `db`, `redis`, `backend`, `frontend` (nginx), `backup` (busybox crond, 03:00 UTC daily pg_dump). HTTPS via Certbot + Let's Encrypt. Backend not exposed externally; nginx proxies `/api/` and `/uploads/`.

---

## 3. Phase 0 — Multi-Tenant Infrastructure

### 3.1 Goals

- One platform PostgreSQL database (properties registry)
- One per-property isolated PostgreSQL database (current DB becomes "zamoskv")
- Stateless request routing by `X-Property-Slug` / JWT claim (already implemented)
- Superadmin UI: list / enable / disable / create properties
- Per-property Docker stacks (independent deploy, independent DB)
- HTTPS automated via Certbot in docker-compose

### 3.2 Platform Database Extensions

Additional `properties` columns (new migration `002_platform_properties_v2`):
```sql
ALTER TABLE properties ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS primary_color VARCHAR(20) DEFAULT '#C9A96E';
ALTER TABLE properties ADD COLUMN IF NOT EXISTS feature_flags JSONB DEFAULT '{}';
-- feature_flags keys: push_notifications, announcements, qr_pass, meter_readings,
--                     space_booking, webhooks, analytics
ALTER TABLE properties ADD COLUMN IF NOT EXISTS sms_provider_config JSONB;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT;
ALTER TABLE properties ADD COLUMN IF NOT EXISTS telegram_bot_username TEXT;

CREATE TABLE IF NOT EXISTS platform_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
  refresh_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 3.3 Superadmin API

All endpoints under `/platform/api/v1/` protected by `PLATFORM_JWT_SECRET`-signed JWTs.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/platform/api/v1/auth/login` | Email + password → JWT |
| POST | `/platform/api/v1/auth/refresh` | Rotate refresh token |
| GET | `/platform/api/v1/properties` | List all properties |
| POST | `/platform/api/v1/properties` | Create property + provision DB |
| GET | `/platform/api/v1/properties/:slug` | Property detail + health |
| PATCH | `/platform/api/v1/properties/:slug` | Update metadata |
| POST | `/platform/api/v1/properties/:slug/disable` | Set `is_active = false` |
| POST | `/platform/api/v1/properties/:slug/enable` | Set `is_active = true` |
| GET | `/platform/api/v1/audit-log` | Platform audit log, paginated |

Property creation flow:
1. Validate slug: `^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$`
2. `INSERT INTO properties` with provided `db_connection_url`
3. Run property DB migrations against the new connection URL
4. Log `platform_audit_log` action `property.created`

### 3.4 Superadmin UI

Separate React SPA deployed at `/platform` sub-path or `platform.domhub.ru`. Reuses DomHub design system tokens.

**Routes:**
- `/platform/login` — email + password
- `/platform/properties` — table with enable/disable/edit actions
- `/platform/properties/new` — create wizard
- `/platform/properties/:slug` — detail: feature flags, health, users count
- `/platform/audit` — paginated audit log

### 3.5 Per-Property Docker Stack Template

```yaml
# docker-compose.property.yml
services:
  db-${PROPERTY_SLUG}:
    image: postgres:16-alpine
    volumes: [db_data:/var/lib/postgresql/data]
  redis-${PROPERTY_SLUG}:
    image: redis:7-alpine
  backend-${PROPERTY_SLUG}:
    environment:
      DATABASE_URL: postgresql://.../${PROPERTY_SLUG}
      PLATFORM_DB_URL: ${PLATFORM_DB_URL}
      X_PROPERTY_SLUG: ${PROPERTY_SLUG}
  frontend-${PROPERTY_SLUG}:
    environment:
      VITE_PROPERTY_SLUG: ${PROPERTY_SLUG}
      VITE_PROPERTY_NAME: ${PROPERTY_NAME}
  certbot:
    image: certbot/certbot
    # 12h renewal loop
  backup:
    # pg_dump nightly, 7-day rotation
```

### 3.6 HTTPS via Certbot

Certbot service runs a 12h renewal loop. Nginx serves `/.well-known/acme-challenge/` from shared volume. Initial certificate: one-time manual `certbot certonly --standalone`. Documented in `DEPLOY.md`.

### 3.7 Cross-Cutting Phase 0 Changes

**Background jobs per-property** — `runtimeJobs.js` must iterate all active properties:
```javascript
const { rows: properties } = await getPlatformDb().query(
  'SELECT * FROM properties WHERE is_active = true'
);
for (const property of properties) {
  const pool = getPropertyPool(property);
  startRuntimeJobs({ db: pool, property });
}
```

**SSE isolation** — namespace `clients` Map by property slug:
`Map<propertySlug, Map<uid, Set<{res, role}>>>`

**Rate limiting** — add property slug to Redis key namespace to prevent cross-property budget sharing.

---

## 4. Phase 0.5 — DomHub Design System

### 4.1 Token Alignment

The v1 `tokens.css` already defines the DomHub palette. v2 formalizes these as the Design System with semantic aliases.

**Canonical token mapping:**

| Semantic | CSS Variable | Dark Value |
|---|---|---|
| `--ds-bg-base` | alias `--s0` | `#11100e` |
| `--ds-bg-surface` | alias `--s2` | `#201d19` |
| `--ds-bg-raised` | alias `--s3` | `#2a2621` |
| `--ds-accent` | alias `--g2` | `#c9a96e` |
| `--ds-text-primary` | alias `--t1` | `#eee7dc` |
| `--ds-text-secondary` | alias `--t2` | `#c7bdae` |
| `--ds-text-muted` | alias `--t3` | `#b2a593` |
| `--ds-border` | alias `--b1` | `rgba(201,169,110,0.12)` |
| `--ds-success` | alias `--ok-t` | `#6fa07e` |
| `--ds-error` | alias `--err-t` | `#d47070` |
| `--ds-warning` | alias `--wrn-t` | `#c9a96e` |

**Typography additions:** Add Inter as preferred font, self-hosted from `/static/fonts/` (avoids Google Fonts data transfer for ФЗ-152).

### 4.2 Component Library (Storybook)

New components to add in `frontend/src/ui/` (following existing `ui/` pattern):

| Component | Description |
|---|---|
| `Button` | primary/secondary/ghost/danger, loading state, icon slot |
| `Card` | surface card with header/footer slots, optional gold accent border |
| `Badge` | status pills (pending/approved/rejected/overdue/paid) |
| `Modal` | focus-trap, keyboard dismiss, sm/md/lg sizes |
| `Sheet` | bottom sheet for mobile |
| `Calendar` | month view for space booking (Phase 3) |
| `QRCode` | renders QR from string, PNG export (Phase 2) |
| `NotificationBanner` | pinned top bar for urgent announcements |
| `Chart` | thin wrapper over recharts for analytics (Phase 6) |
| `DataTable` | sortable, paginated, CSV export |
| `Toggle` | accessible on/off for feature flags |

Storybook CI gate: `npm run build-storybook` must pass on every PR.

### 4.3 Micro-Animation Guidelines

All animations must respect `@media (prefers-reduced-motion: reduce)`.

| Pattern | Duration | Easing |
|---|---|---|
| Presence (fade+slide) | 180ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Button press | 100ms | `ease-out` (scale 0.97) |
| Sheet/modal open | 280ms | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Toast slide-in | 240ms | ease |

Prohibited: parallax, auto-playing video, infinite spin on non-loading states.

---

## 5. Phase 1 — Push Notifications

### 5.1 Architecture

Three channels: Web Push (Firebase FCM), SMS (sms.ru — existing), Telegram bot per property. All go through `services/notificationService.js` `dispatch(event, data)`.

### 5.2 Database (migration `012_push_notifications`)

```sql
-- Extend push_subscriptions (created in 011):
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS platform VARCHAR(20) DEFAULT 'web';
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(uid) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL,        -- 'push' | 'sms' | 'telegram'
  event_type VARCHAR(60) NOT NULL,
  payload JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_log_user ON notification_log(user_id, created_at DESC);
```

### 5.3 Web Push (FCM)

Env vars: `FCM_SERVER_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

```
POST /api/v1/push-subscriptions   — subscribe (upsert endpoint+keys)
DELETE /api/v1/push-subscriptions/:id — unsubscribe
```

Dead endpoint detection: `statusCode 410/404` from FCM → set `is_active = false`. After `failure_count >= 5` → deactivate.

### 5.4 Telegram Bot

One bot per property via `properties.telegram_bot_token`.

**Resident linking flow:**
1. Frontend: "Connect Telegram" → deep link `https://t.me/<BOT>?start=<linkToken>`
2. Backend: generate UUID token, store in Redis with TTL 600s, key `tg_link:<token>` → userId
3. Bot `/start <token>` handler → lookup userId, insert `push_subscriptions` with `platform='telegram'`, `telegram_chat_id`

### 5.5 Event Triggers

| Event | Channels | Recipient |
|---|---|---|
| `guest.arrived` | push + sms | Pass creator |
| `request.approved` | push + telegram | Pass creator |
| `request.rejected` | push + telegram | Pass creator |
| `announcement.published` | push | All residents |
| `blacklist.attempt` | push + sms + telegram | security + admin |
| `package.arrived` (Phase 4) | push + sms | Recipient |
| `booking.confirmed` (Phase 3) | push | Booking creator |
| `meter.reminder` (Phase 3) | push | Resident (monthly cron) |
| `billing.overdue` (Phase 3) | push + sms | Resident |

---

## 6. Phase 2 — Announcements, Documents, QR Pass

### 6.1 Announcements (migration `013_announcements_v2`)

```sql
-- Extend announcements table (created in 011):
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_label VARCHAR(100);
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS cta_url TEXT;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
```

**API:**
```
GET    /api/v1/announcements          — active (optional kiosk=1)
GET    /api/v1/announcements/:id
POST   /api/v1/announcements          — admin
PATCH  /api/v1/announcements/:id      — admin
DELETE /api/v1/announcements/:id      — admin (soft delete)
```

Active filter: `(expires_at IS NULL OR expires_at > NOW()) AND deleted_at IS NULL`

### 6.2 Documents

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(category, sort_order)
  WHERE deleted_at IS NULL;
```

PDF upload via existing `POST /api/v1/upload`. Markdown body supported for inline display.

### 6.3 Kiosk Mode

Route `/info` — public, no auth, no cookie. Polls announcements every 60s. Full-screen carousel for lobby tablet (1080p landscape). Rate-limited: 50 req/min per IP.

### 6.4 QR Pass (migration `014_qr_pass`)

```sql
CREATE TABLE IF NOT EXISTS qr_passes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,        -- 32 bytes hex, secure random
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  used_by_uid TEXT REFERENCES users(uid),
  invalidated_at TIMESTAMPTZ,
  invalidated_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_qr_passes_token ON qr_passes(token) WHERE invalidated_at IS NULL;
```

**Flow:**
1. Request approved → backend creates `qr_passes` row, token = `randomBytes(32).toString('hex')`
2. Guest receives SMS/Telegram: `https://zamoskv.ru/pass/<token>`
3. Guest opens URL → premium card with QR code, visitor name, apartment, validity, download as PNG
4. Guard scans QR → `POST /api/v1/guard/scan-pass { token }` → validates → returns request details
5. Guard admits/denies → `POST /api/v1/guard/scan-pass/:id/admit|deny` → records `visit_logs`

**Endpoints:**
```
GET  /api/v1/public/pass/:token           — no auth, rate-limited 30/min/IP
POST /api/v1/guard/scan-pass              — staff auth
POST /api/v1/guard/scan-pass/:id/admit   — staff auth
POST /api/v1/guard/scan-pass/:id/deny    — staff auth
```

---

## 7. Phase 3 — Resident Dashboard Expansion

### 7.1 Meter Readings (migration `015_resident_features`)

```sql
CREATE TABLE IF NOT EXISTS meter_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  apartment TEXT NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('hot_water', 'cold_water', 'electric', 'gas')),
  value NUMERIC(12, 3) NOT NULL,
  unit VARCHAR(10) DEFAULT 'm3',
  photo_url TEXT,
  ocr_raw TEXT,
  ocr_confidence REAL,
  period_year SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  submitted_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_by TEXT REFERENCES users(uid),
  reviewed_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE(user_id, type, period_year, period_month)
);
```

OCR hint via `POST /api/v1/meter-readings/ocr-hint { photo_url }` → Yandex Vision API (preferred for ФЗ-152). Optional — returns `{ value: null, confidence: 0 }` if not configured.

Monthly reminder: cron job fires on 25th of each month, pushes notification to all active residents.

### 7.2 Billing Records

```sql
CREATE TABLE IF NOT EXISTS billing_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  apartment TEXT NOT NULL,
  period_year SMALLINT NOT NULL,
  period_month SMALLINT NOT NULL,
  description TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'RUB',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled')),
  due_date DATE,
  paid_at TIMESTAMPTZ,
  payment_link TEXT,
  invoice_url TEXT,
  external_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Overdue job: runs daily at 09:00 Moscow, sets `status = 'overdue'` where `status = 'pending' AND due_date < NOW()`, sends push+SMS.

### 7.3 Space Booking

```sql
CREATE TABLE IF NOT EXISTS spaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL,  -- 'party_room','sauna','gym','bbq','roof','conference'
  capacity INTEGER,
  price_per_slot NUMERIC(10,2) DEFAULT 0,
  slot_duration_minutes INTEGER DEFAULT 60,
  open_time TIME DEFAULT '08:00',
  close_time TIME DEFAULT '22:00',
  advance_days INTEGER DEFAULT 14,
  max_concurrent_bookings INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT true,
  photo_url TEXT,
  rules TEXT,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS space_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  space_id UUID NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status VARCHAR(20) DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','pending_approval')),
  attendees_count INTEGER DEFAULT 1,
  notes TEXT,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT REFERENCES users(uid),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT no_overlap EXCLUDE USING gist (
    space_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  ) WHERE (status NOT IN ('cancelled'))
);
-- Requires: CREATE EXTENSION IF NOT EXISTS btree_gist;
```

### 7.4 Move-in / Move-out

New `requests.type` values: `move_in`, `move_out`.
```sql
ALTER TABLE requests ADD COLUMN IF NOT EXISTS freight_elevator_needed BOOLEAN DEFAULT false;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS parking_spot_reserved TEXT;
```

---

## 8. Phase 4 — Concierge & Requests

### 8.1 Extended Request Types

New `type` values (additive to existing `pass`, `car`, `garage`, `tech`):
`repair`, `cleaning`, `concierge`, `complaint`, `suggestion`

### 8.2 SLA Configuration (migration `016_sla_and_packages`)

```sql
CREATE TABLE IF NOT EXISTS request_sla_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type VARCHAR(30) NOT NULL UNIQUE,
  sla_hours INTEGER NOT NULL DEFAULT 24,
  escalation_hours INTEGER,
  is_active BOOLEAN DEFAULT true
);

INSERT INTO request_sla_config (request_type, sla_hours, escalation_hours) VALUES
  ('repair', 24, 48), ('cleaning', 4, 8), ('concierge', 2, 4),
  ('complaint', 48, 72), ('suggestion', 72, NULL),
  ('pass', 1, 2), ('car', 1, 2), ('tech', 8, 24)
ON CONFLICT (request_type) DO NOTHING;
```

Overdue job runs every 15 min. Inserts `request_history` row `label = 'sla_overdue_notified'` to prevent duplicate alerts.

### 8.3 Post-Completion Rating

```sql
ALTER TABLE requests ADD COLUMN IF NOT EXISTS rating SMALLINT CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE requests ADD COLUMN IF NOT EXISTS rating_comment TEXT;
ALTER TABLE requests ADD COLUMN IF NOT EXISTS rated_at TIMESTAMPTZ;
```

New terminal status `completed` (`approved → completed` by staff).
```
POST /api/v1/requests/:id/rate  { rating: 1-5, comment? }
```

### 8.4 Package Receipt

```sql
CREATE TABLE IF NOT EXISTS packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id TEXT REFERENCES users(uid) ON DELETE SET NULL,
  recipient_apartment TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  sender_name TEXT,
  tracking_number TEXT,
  carrier VARCHAR(50),
  photo_url TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  received_by TEXT NOT NULL REFERENCES users(uid),
  picked_up_at TIMESTAMPTZ,
  picked_up_by_name TEXT,
  notified_at TIMESTAMPTZ,
  status VARCHAR(20) DEFAULT 'awaiting_pickup'
    CHECK (status IN ('awaiting_pickup','picked_up','returned')),
  notes TEXT
);
```

Reminder job: daily at 18:00, send push for packages awaiting pickup > 2 days.

```
POST  /api/v1/packages                   — staff only
GET   /api/v1/packages                   — staff: all; resident: own
PATCH /api/v1/packages/:id/pickup        — staff only
```

---

## 9. Phase 5 — Webhook Engine & Integrations

### 9.1 Webhook Engine (migration `017_webhooks`)

```sql
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  events TEXT[] NOT NULL,
  is_active BOOLEAN DEFAULT true,
  retry_count INTEGER DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  created_by TEXT REFERENCES users(uid)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type VARCHAR(60) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempt_count INTEGER DEFAULT 0,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  response_status INTEGER,
  response_body TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries(next_attempt_at)
  WHERE status IN ('pending', 'retrying');

-- Add clip_url to visit_logs for video surveillance integration
ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS clip_url TEXT;
```

**Delivery:** HMAC-SHA256 signature in `X-DomHub-Signature` header. Retry schedule: 1m → 5m → 30m (3 attempts). Background worker runs every 30s.

**API:**
```
GET    /api/v1/webhooks
POST   /api/v1/webhooks              — { name, url, secret, events[] }
PATCH  /api/v1/webhooks/:id
DELETE /api/v1/webhooks/:id
POST   /api/v1/webhooks/:id/test     — immediate test delivery
GET    /api/v1/webhooks/:id/deliveries
```

### 9.2 СКУД Adapters

Abstract interface `services/skud/SkudAdapter.js` with methods `addAccess(passId, personData)`, `removeAccess(passId)`, `getStatus(passId)`.

Implementations: `BolidAdapter.js`, `HikvisionAdapter.js` (ISAPI REST), `SigurAdapter.js`.

Selected per-property via `properties.feature_flags.skud_adapter`. Triggers: `request.approved` → addAccess; `request.expired/rejected` → removeAccess.

### 9.3 Telegram Guard Commands

```
/pass <token>
→ Show pass details + [✅ Пропустить] [❌ Отклонить] inline buttons
Callbacks: admit_<visitLogId> / deny_<visitLogId>
```

### 9.4 1С Billing Sync

```
POST /api/v1/integrations/billing-sync
  Header: X-Integration-Secret: <env secret>
  Body: [{ apartment, period_year, period_month, amount, description, due_date, external_id, payment_link }]
→ Upsert billing_records
→ { created: N, updated: M, errors: [] }
```

### 9.5 Video Clip Integration

```
POST /api/v1/integrations/visit-clip
  Body: { visit_log_id, clip_url }
→ UPDATE visit_logs SET clip_url = $1 WHERE id = $2
```

---

## 10. Phase 6 — Analytics

### 10.1 Per-Property Endpoints (admin-only)

All results cached in Redis (TTL 5 min for real-time, 1h for daily charts).

```
GET /api/v1/analytics/traffic?from=&to=&granularity=hour|day
GET /api/v1/analytics/top-residents?from=&to=&limit=10
GET /api/v1/analytics/sla?from=&to=
GET /api/v1/analytics/requests?from=&to=
GET /api/v1/analytics/packages?from=&to=
```

All endpoints accept `?format=csv` → `Content-Type: text/csv` download.

### 10.2 Platform Analytics (superadmin)

Aggregates from platform DB + per-property DBs (counts only, no PII cross-boundary):

```
GET /platform/api/v1/analytics/overview
GET /platform/api/v1/analytics/webhook-health
```

### 10.3 Frontend

Charts via `recharts`. `DataTable` component with CSV export.

---

## 11. ФЗ-152 Compliance

### 11.1 Data Residency

All databases on Timeweb (Russia). Specific restrictions:
- **FCM:** send only device tokens to Google, never PII in notification body. Use "У вас новое сообщение" style with details loaded in-app.
- **Yandex Vision (OCR):** preferred over Google Vision (Russian operator).
- **Sentry:** configure `beforeSend` to scrub `phone`, `name`, `uid`, `apartment`.

### 11.2 Consent

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_given_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS consent_version VARCHAR(10);
```

Consent modal on first login (or first login after policy update). Existing users without `consent_given_at` see modal on next login.

### 11.3 Right to Erasure

```
POST /api/v1/admin/users/:uid/gdpr-delete  — admin only
```

Transaction: anonymize `users` (name, phone, avatar, apartment), anonymize `requests` (visitor_name, visitor_phone), delete `push_subscriptions` and `refresh_tokens`, anonymize `visit_logs`. Log to `platform_audit_log`.

### 11.4 Data Minimization

- Photos for expired requests: deleted after 365 days (new cleanup job)
- `notification_log`: retain 90 days
- OTP codes, token revocations: already cleaned up by existing jobs

### 11.5 Privacy Policy

Stored as a `documents` record (`category='rules'`, `is_public=true`). Must include: operator details, processing purposes, data list, third parties (sms.ru, Yandex Vision), retention periods, user rights, contact email.

---

## 12. Timeweb Deployment

### 12.1 Infrastructure

- Recommended VPS: 4 vCPU, 8 GB RAM, 80 GB SSD NVMe per property
- Platform DB: separate `docker-compose.platform.yml`, bound to `127.0.0.1:5433`
- Russian SMS: sms.ru (already integrated, no changes needed)

### 12.2 Environment Variables (v2 additions)

```env
# Platform
PLATFORM_DB_URL=postgresql://domhub_platform:PASSWORD@localhost:5433/domhub_platform
PLATFORM_JWT_SECRET=<openssl rand -hex 32>

# Push
FCM_SERVER_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@zamoskv.ru

# Telegram (optional, per-property)
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=

# OCR (optional)
YANDEX_VISION_API_KEY=
YANDEX_FOLDER_ID=

# СКУД (optional)
SKUD_ADAPTER=hikvision   # bolid|hikvision|sigur|''
SKUD_API_URL=
SKUD_API_USER=
SKUD_API_PASSWORD=

# Integrations
BILLING_SYNC_SECRET=<openssl rand -hex 24>
```

---

## 13. API Versioning Strategy

- `/api/v1/*` — stable, all new features added here
- `/api/*` — deprecated shims, unchanged, removed in v3
- **Breaking change rule:** never remove fields, never change field types on existing endpoints
- New breaking changes go to `/api/v2/` with `Deprecation` header on v1 endpoint
- OpenAPI spec (`docs/openapi.json`) must be updated before PR merge

---

## 14. Migration Strategy v1 → v2

### 14.1 Principles

1. **Additive only:** `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`
2. **No breaking API changes**
3. **Feature flags:** each feature controlled by `properties.feature_flags` — deploy code, enable per-property
4. **Migration IDs:** continue from 012

### 14.2 Phase 0 Rollout

1. Set `PLATFORM_DB_URL` in `.env`
2. Startup runs `migratePlatform()` → creates tables, seeds `zamoskv`
3. Frontend adds `X-Property-Slug: zamoskv` header to all API requests (via `apiClient.ts` interceptor)
4. New JWTs include `property_slug` claim; old tokens fall back to header

### 14.3 "zamoskv" First Property

Current production DB becomes property `zamoskv` with zero data migration. All historical data preserved in-place.

### 14.4 Phase Dependency Order

```
Phase 0 (multi-tenant)      → required by ALL phases
Phase 0.5 (design system)   → required by Phase 2 (kiosk), 3 (calendar), 6 (charts)
Phase 1 (notifications)     → used by Phases 2, 3, 4, 5
Phase 2 (QR pass)           → enhances Phase 0 request flow
Phase 3 (resident expansion)→ independent, uses Phase 1 for reminders
Phase 4 (concierge)         → extends Phase 0 requests
Phase 5 (webhooks)          → uses Phase 1 event bus pattern
Phase 6 (analytics)         → requires Phases 2-5 data
```

---

## 15. Technology Choices Rationale

| Dependency | Phase | Rationale |
|---|---|---|
| `web-push` | 1 | Web Push Protocol + VAPID standard library |
| `node-telegram-bot-api` or `grammy` | 1 | Polling + webhook modes, single-process |
| `qrcode` | 2 | Pure JS, SVG/PNG output, no native deps |
| `recharts` | 6 | React-native, small bundle |
| `@storybook/react-vite` | 0.5 | Dev-only, no production impact |

**No new message queue:** `webhook_deliveries` table + background worker is sufficient for expected scale (< 100 webhooks, < 1000 events/day). Extractable to separate process if needed.

**PostgreSQL EXCLUDE for bookings:** database-level overlap prevention prevents race conditions from concurrent booking attempts. Requires `btree_gist` extension.

---

## 16. Cross-Phase Constraints

### 16.1 Property Context for All New Endpoints

Every new route must use `propertyDbMiddleware` (except `/platform/` and `/public/`). All queries use `req.db.query(...)`, never the global `db.query(...)`.

### 16.2 Per-Property Audit Log (migration `012`)

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_uid TEXT REFERENCES users(uid) ON DELETE SET NULL,
  actor_role TEXT,
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id TEXT,
  changes JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

All admin mutations (announcements, documents, spaces, billing, webhooks, blacklist) must write here.

### 16.3 Test Coverage Requirements

Every new route file must have tests in `backend/src/__tests__/`. Critical paths require:
- Happy path
- Auth failure (401/403)
- Validation failure (400)
- Not-found (404)

Frontend: new views need smoke test + Storybook story for each shared component.

---

## Critical Files

- `backend/src/db.js` — connection management
- `backend/src/middleware/propertyDb.js` — multi-tenant routing
- `backend/src/dbMigrations.js` — property DB migrations
- `backend/src/platformMigrations.js` — platform DB migrations
- `backend/src/server/runtimeJobs.js` — background jobs (needs per-property loop)
- `frontend/src/styles/tokens.css` — design tokens
- `frontend/src/services/http/apiClient.ts` — add X-Property-Slug header
