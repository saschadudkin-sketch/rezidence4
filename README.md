# Rezidence4

`rezidence4` is a workspace with three layers:

- `frontend/` - React + Vite
- `backend/` - Express + PostgreSQL
- root - shared orchestration, Playwright E2E, release scripts

## Canonical Commands

```bash
npm run bootstrap
npm run dev
npm run test
npm run lint
npm run typecheck
npm run build
```

Additional checks:

```bash
npm run backend:test
npm run frontend:test
npm run verify
npm run e2e
npm run install:all
```

## Environment

- Root deployment template: [`.env.example`](./.env.example)
- Frontend production build requires `VITE_API_URL` and `VITE_RUNTIME_MODE`
- Backend runtime requires `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, and `UPLOAD_SIGNING_SECRET`
- `npm run verify:env` in `frontend/` validates production-like build requirements by default

## Deploy

Use the single canonical guide: [DEPLOY.md](./DEPLOY.md)
