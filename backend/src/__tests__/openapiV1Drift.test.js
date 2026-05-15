'use strict';

const {
  extractMountedPrefixes,
  extractMountedOperations,
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

  test('extracts exact mounted /api/v1 operations', () => {
    const source = `
      app.get('/api/v1/events', handler);
      app.get('/api/v1/events/health', handler);
      app.post('/api/v1/upload/sign', handler);
      app.use('/api/v1/requests', requestsRouter);
    `;
    expect(extractMountedOperations(source)).toEqual([
      { method: 'get', path: '/api/v1/events' },
      { method: 'get', path: '/api/v1/events/health' },
      { method: 'post', path: '/api/v1/upload/sign' },
    ]);
  });

  test('extracts router-level operations behind mounted /api/v1 routers', () => {
    const source = `
      const requestsRouter = require('../routes/requests');
      app.use('/api/v1/requests', authMiddleware, requestsRouter);
    `;
    const routerSource = `
      router.get('/', handler);
      router.post('/:id/updates', handler);
    `;

    expect(extractMountedOperations(source, {
      readFile: () => routerSource,
      baseDir: __dirname,
    })).toEqual([
      { method: 'get', path: '/api/v1/requests' },
      { method: 'post', path: '/api/v1/requests/{id}/updates' },
    ]);
  });

  test('current OpenAPI covers mounted /api/v1 prefixes and operations', () => {
    const result = run();
    expect(result.missing).toEqual([]);
    expect(result.missingOperations).toEqual([]);
    expect(result.mountedOperations).toContainEqual({ method: 'post', path: '/api/v1/auth/verify-otp' });
  });

  test('v1 communications and packages do not have legacy fall-through mounts', () => {
    const result = run();
    expect(result.mountedOperations).toContainEqual({ method: 'post', path: '/api/v1/packages/{id}/pickup' });
    expect(result.mountedOperations).not.toContainEqual({ method: 'patch', path: '/api/v1/packages/{id}/pickup' });
    expect(result.mountedOperations).not.toContainEqual({ method: 'patch', path: '/api/v1/packages/{id}/return' });
  });
});
