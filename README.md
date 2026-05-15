# Rezidence Platform

Multi-tenant residential complex management platform. Each complex gets its own PostgreSQL database; a central Registry DB maps subdomains to connection strings.

## Architecture

```
┌─────────────────────────────────────────┐
│           Registry DB (central)         │
│  complexes: slug → DSN + status         │
│  platform_users, webhook_endpoints      │
└────────────────┬────────────────────────┘
                 │ complexResolver middleware
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  Object DB   Object DB   Object DB
  (zhk-one)  (zhk-two)   (demo)
  users       users        users
  access      access       access
  board ...   board ...    board ...
```

### Platform v1 modules (per-object)
`/api/v1/*` is the source-of-truth contract surface. Legacy `/api/*` aliases
exist only as compatibility shims.

| Module | Path | Status |
|--------|------|--------|
| Auth/session | `/api/v1/auth` | Core: OTP phone auth, JWT + refresh rotation |
| Access requests | `/api/v1/access-requests` | Core: resident/guest/staff/contractor access workflow |
| Passes and verification | `/api/v1/passes`, `/api/v1/verify` | Core: QR/manual/plate access decisions |
| Access topology | `/api/v1/access-zones`, `/api/v1/access-points` | Core: zones, checkpoints, territory-aware points |
| Access policies | `/api/v1/access-policies` | Core: deterministic policy evaluation; biometric methods are dormant |
| Vehicles | `/api/v1/vehicles` | Core: resident/guest vehicle baseline |
| Guard/security workspace | `/api/v1/visit-logs`, `/api/v1/access-incidents`, `/api/v1/security/*` | Core: checkpoint operations, incidents, offline replay |
| Staff/contractor workspaces | `/api/v1/staff-workspace`, `/api/v1/technician-workspace`, `/api/v1/contractor-workspace` | Core/pilot: operational execution queues |
| Residents/units | `/api/v1/residents`, `/api/v1/units` | Core/pilot: lifecycle, imports, offboarding evidence |
| Portfolio/admin readiness | `/api/v1/operations-dashboard`, `/api/v1/management-company-portfolio`, `/api/v1/gis-oss-*`, `/api/v1/skud-*`, `/api/v1/sensitive-actions` | Pilot/readiness layer |
| Legacy utilities | `/api/v1/billing`, `/api/v1/bookings`, `/api/v1/meter-readings`, `/api/v1/spaces`, `/api/v1/chat` | Gated/legacy compatibility; not first-working-MVP evidence |

---

## Quick Start (Development)

### Prerequisites
- Node.js 20+
- Docker & Docker Compose

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET and UPLOAD_SIGNING_SECRET
```

### 2. Start databases

```bash
docker compose up postgres-registry postgres-object-demo redis -d
```

### 3. Run migrations

```bash
cd backend
npm install
node src/db/migrate.js registry
node src/db/migrate.js object demo
```

### 4. Register the demo complex in Registry

```bash
psql postgresql://rezidence:rezidence_dev@localhost:5432/rezidence_registry -c "
  INSERT INTO complexes (slug, name, dsn, city, plan) VALUES
  ('demo', 'Demo Complex', 'postgresql://rezidence:object_dev@localhost:5433/rezidence_demo', 'Moscow', 'comfort');
"
```

### 5. Start backend

```bash
cd backend
npm run dev
```

### 6. Start frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The frontend reads `VITE_COMPLEX_SLUG=demo` from `.env` to route all API calls to the demo complex.

---

## Production (Docker Compose)

```bash
cp .env.example .env
# Fill in all production secrets

docker compose up -d
```

Then run migrations inside the backend container:

```bash
docker compose exec backend node src/db/migrate.js registry
docker compose exec backend node src/db/migrate.js object demo
```

---

## Adding a new complex

1. Provision a new PostgreSQL database (any host/provider).
2. POST to `/api/v1/platform/complexes` (superadmin token required):

```json
{
  "name": "ЖК Замоскворечье",
  "slug": "zamoskvorechye",
  "dsn": "postgresql://user:pass@host:5432/dbname",
  "city": "Москва",
  "plan": "comfort"
}
```

The platform will automatically run migrations on the new DB and register it in the Registry. The complex is immediately available at `zamoskvorechye.yourdomain.com`.

## Disconnecting a complex

```bash
PATCH /api/v1/platform/complexes/:id/status
{ "status": "suspended" }   # 503 to all users, instant
{ "status": "maintenance" } # 503 with maintenance message
{ "status": "terminated" }  # 410 Gone, permanent
```

Status changes take effect within seconds (30s resolver cache is invalidated immediately).

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REGISTRY_DATABASE_URL` | Yes | Central Registry PostgreSQL DSN |
| `REDIS_URL` | No | Redis for token revocation (graceful degradation) |
| `JWT_SECRET` | Yes | Min 32 chars |
| `FRONTEND_URL` | Prod | CORS allowed origin |
| `UPLOAD_SIGNING_SECRET` | Prod | Signs upload URLs |
| `PORT` | No | HTTP port (default 3000) |
