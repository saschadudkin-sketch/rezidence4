# E2E Playwright setup & troubleshooting

**Date:** 2026-04-02

## Quick start

```bash
npm install
npx playwright install chromium
npm run test:e2e -- e2e/login-flow.spec.js --project=chromium
```

## Common Linux dependency issue

If Playwright fails with:

- `error while loading shared libraries: libatk-1.0.so.0`

install missing system dependencies in the runner image/VM:

```bash
npx playwright install-deps chromium
```

If your environment does not allow `install-deps`, preinstall the required GTK/ATK stack in the base image used by CI.

## Recommended CI order

1. `npm ci`
2. `npx playwright install chromium`
3. `npx playwright install-deps chromium`
4. `npm run test:e2e -- e2e/login-flow.spec.js --project=chromium`

