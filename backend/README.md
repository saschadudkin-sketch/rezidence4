# Backend maintenance notes

## Logger config contract

`src/logger.js` builds pino config through `src/loggerConfig.js`.

Expected behavior:

- `NODE_ENV=test` → `level: "warn"`, `transport: undefined`
- `NODE_ENV=development` → `level: "info"` (or `LOG_LEVEL` override), `transport.target: "pino-pretty"`
- `NODE_ENV=production` → `level: "info"` (or `LOG_LEVEL` override), `transport: undefined`
- missing `NODE_ENV` → same fallback as production (`info`, no transport)

`LOG_LEVEL` always has higher priority than defaults for any environment.

## Test suite boundaries

- Keep logger-specific cases in `src/__tests__/logger.test.js`.
- Keep `src/__tests__/infrastructure.test.js` for bootstrap/entry checks (`index`, `migrate`, `seed`) only.

## Merge gate (required)

Before merging:

1. `cd backend && npm test`
2. `cd frontend && npm test -- --watchAll=false`
