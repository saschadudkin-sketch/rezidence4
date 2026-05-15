'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('deprecated /api/* shims', () => {
  const deprecatedShimPrefixes = [
    '/api/auth',
    '/api/requests',
    '/api/users',
    '/api/chat',
    '/api/perms',
    '/api/templates',
    '/api/blacklist',
    '/api/visit-logs',
    '/api/upload',
    '/api/contracts',
    '/api/client-logs',
  ];

  test('tenant resolver and deprecation middleware are mounted before every legacy route handler', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../app/registerApiRoutes.js'),
      'utf8',
    );

    for (const prefix of deprecatedShimPrefixes) {
      const line = source
        .split('\n')
        .find((entry) => entry.includes(`app.use('${prefix}'`));
      expect(line).toContain('propertyDbMiddleware');
      expect(line).toContain('deprecate');
    }
  });

  test('operational non-v1 routes are explicit ops carveouts, not compatibility shims', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../app/registerObservabilityRoutes.js'),
      'utf8',
    );

    for (const route of [
      '/api/health',
      '/api/docs/openapi.json',
      '/api/health/detailed',
      '/api/metrics',
      '/api/metrics/prometheus',
    ]) {
      expect(source).toContain(route);
    }
  });
});
