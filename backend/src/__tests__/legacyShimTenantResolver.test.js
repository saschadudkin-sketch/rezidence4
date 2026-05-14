'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('deprecated /api/* shims', () => {
  test('tenant resolver is mounted before legacy route handlers', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../app/registerApiRoutes.js'),
      'utf8',
    );

    for (const prefix of ['/api/auth', '/api/requests', '/api/users']) {
      const line = source
        .split('\n')
        .find((entry) => entry.includes(`app.use('${prefix}'`));
      expect(line).toContain('propertyDbMiddleware');
    }
  });
});
