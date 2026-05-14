'use strict';

const {
  extractMountedPrefixes,
  run,
} = require('../../../scripts/openapi-v1-drift-gate.cjs');

describe('OpenAPI v1 drift gate', () => {
  test('extracts mounted /api/v1 prefixes from registerApiRoutes source', () => {
    const source = `
      app.use('/api/v1/requests', requestsRouter);
      app.use('/api/v1/admin/outbox', outboxRouter);
      app.use('/api/v1', rootRouter);
    `;
    expect(extractMountedPrefixes(source)).toEqual([
      '/api/v1/admin/outbox',
      '/api/v1/requests',
    ]);
  });

  test('current OpenAPI covers mounted /api/v1 prefixes', () => {
    const result = run();
    expect(result.missing).toEqual([]);
  });
});
