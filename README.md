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

The repository's current local baseline is the full Docker Compose stack. The old instructions naming `postgres-registry`, `postgres-object-demo`, and `backend/src/db/migrate.js` do not match the current Compose services and migration entrypoint.

### Prerequisites
- Git
- Node.js 20 LTS or compatible with the lockfiles
- Docker Desktop with Docker Compose v2

### 1. Clone and create local configuration

```bash
git clone https://github.com/saschadudkin-sketch/rezidence4.git
cd rezidence4
git switch codex/mobile-app-foundation
cp .env.example .env
```

Open `.env` and replace the placeholder values for `DB_PASSWORD`, `JWT_SECRET`, `PLATFORM_JWT_SECRET`, `REDIS_PASSWORD`, and `UPLOAD_SIGNING_SECRET` with unique random values. Keep `JWT_SECRET` and `PLATFORM_JWT_SECRET` different. For a local browser session, set:

```dotenv
BACKEND_URL=http://localhost
FRONTEND_URL=http://localhost
YOUR_DOMAIN=localhost
```

Leave `PLATFORM_DB_URL` and `ZAMOSKV_DB_URL` empty for the standard Compose setup; Compose derives their container-network URLs using the `db` service and `DB_PASSWORD`. The checked-in `ops/ci-dummy.env` is for CI only, not a replacement for your local `.env`.

### 2. Validate configuration and start the stack

```bash
docker compose config --quiet
docker compose up --build -d
docker compose ps
```

The current Compose service names are `db`, `redis`, `backend`, `frontend`, and `backup`. The backend container runs `node src/migrate.js` before starting the API; do not use the obsolete `node src/db/migrate.js` command. Database initialization scripts under `ops/db-init/` run only when PostgreSQL's data volume is first created.

Open [http://localhost](http://localhost). If startup fails, inspect the relevant service logs:

```bash
docker compose logs --tail=200 db backend frontend
```

To stop the services without deleting the local database volume:

```bash
docker compose down
```

**Warning:** do not use `docker compose down -v` unless you intentionally want to delete the local database and other Compose volumes. Use only synthetic test data.

### 3. Install dependencies for repository checks

From the repository root:

```bash
npm run bootstrap
```

This runs the root, backend, and frontend lockfile-based installs. Then run targeted checks from the root as appropriate:

```bash
npm run backend:test
npm run frontend:lint
npm run frontend:test
npm run frontend:typecheck
npm run frontend:build
```

These commands have not been certified as passing by this documentation change; record each actual result and its logs before marking the baseline complete. Some integration and E2E checks require the Compose stack and explicit test configuration. Do not run destructive restore or release-gate commands against an environment containing anything other than disposable synthetic data.

### Production

Do not use this development quick start as a production deployment guide. Production requires a separate reviewed environment, real secrets from an approved secret manager, HTTPS, backup/restore evidence, monitoring, security/privacy review, and an explicit release go/no-go approval. No production server or deployment is authorized by this repository plan.

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
