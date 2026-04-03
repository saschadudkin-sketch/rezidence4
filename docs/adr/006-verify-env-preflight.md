# ADR-006: Environment Preflight Validation

**Date:** 2026-04-02  
**Status:** Accepted  
**Addresses:** A-12 (Deep Audit 2026-04-02)

## Context

The production build already fails fast when `VITE_API_URL` is absent (enforced in `vite.config.js`). However, there was no documented, scriptable way to check env variables as a standalone CI preflight step — before running tests or building. Pipeline failures could occur late (mid-build) rather than at the start.

## Decision

Add `scripts/verify-env.js` — a Node.js script that:
1. Reads `NODE_ENV` to determine production vs development mode.
2. Validates all required env variables for the given mode.
3. Exits with code 0 (success) or 1 (missing variables).

The script is added to `package.json` as:
```json
"verify:env": "node scripts/verify-env.js"
```

And integrated into `verify:all`:
```json
"verify:all": "npm run verify:env && vitest run && npm run build"
```

### Required variables by mode

| Variable | Required in |
|---|---|
| `VITE_API_URL` | `production` |

## CI integration

Run `npm run verify:env` as the **first step** in CI before any build or test job. This provides a fast, explicit failure with a clear error message listing which variables are missing.

## Consequences

- Env problems surface at the start of CI, not mid-build.
- The required variable contract is documented in one place (the script + this ADR).
- `verify:all` now covers env → tests → build in sequence.
- Adding new required variables is a one-line change in `verify-env.js`.
