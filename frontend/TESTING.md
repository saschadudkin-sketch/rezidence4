# Testing shortcuts

## Focused mode/services checks

Use this when changing runtime mode resolution, providers, gateways, request workflow or sync feedback:

```bash
npm run test:mode-services
```

This runs:
- `src/config/runtimeMode.test.js`
- `src/domain/requestWorkflow.test.js`
- provider tests (`createServices`, `serviceContainer`, `demoProvider`, `firebaseProvider`)
- gateway tests (`chat`, `requests`, `admin`, `liveData`)
- `src/ui/syncFeedback.test.js`

## Focused verify (tests + build)

```bash
npm run verify:mode-services
```

Runs focused suite above, then `npm run build`.

## Full verify (all unit tests + build)

```bash
npm run verify:all
```

Runs all Jest tests with `--watchAll=false`, then production build.

## Expected end-state for this refactor line

- runtime mode precedence and normalization are covered by tests
- provider/gateway contracts are covered by unit tests
- sync feedback behavior is covered for fallback and success paths
- production build passes after service-layer changes
