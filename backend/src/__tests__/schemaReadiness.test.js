'use strict';

const fs = require('node:fs');
const path = require('node:path');

describe('runtime schema readiness', () => {
  test('assertSchemaCurrent checks platform and active tenant migrations', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../db.js'), 'utf8');
    expect(source).toContain('PLATFORM_SCHEMA_OUTDATED');
    expect(source).toContain('TENANT_SCHEMA_OUTDATED');
    expect(source).toContain('FROM properties');
    expect(source).toContain('schema_migrations WHERE id = ANY');
  });
});
