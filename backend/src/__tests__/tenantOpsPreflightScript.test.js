'use strict';

const {
  buildDbTargets,
  checkDbTarget,
  formatMigrationSummary,
  formatReport,
  redactConnectionString,
  runPreflight,
} = require('../../../scripts/tenant-ops-preflight.cjs');

describe('tenant-ops-preflight script', () => {
  test('redacts database credentials in reports', () => {
    expect(redactConnectionString('postgresql://user:secret@localhost:5432/app'))
      .toBe('postgresql://***:***@localhost:5432/app');
    expect(redactConnectionString('not-a-url')).toBe('<invalid-url>');
    expect(redactConnectionString('')).toBe('<missing>');
  });

  test('builds e2e access targets from DB_PASSWORD defaults', () => {
    const plan = buildDbTargets(
      {
        DB_PASSWORD: 'pw',
        E2E_BACKEND_PORT: '3010',
      },
      { e2eAccess: true },
    );

    expect(plan.targets.map((target) => target.label)).toEqual(['global', 'platform', 'tenant']);
    expect(plan.targets[0].connectionString).toBe('postgresql://residenze:pw@localhost:5432/residenze');
    expect(plan.targets[1].connectionString).toBe('postgresql://residenze:pw@localhost:5432/platform');
    expect(plan.targets[2].connectionString).toBe('postgresql://residenze:pw@localhost:5432/zamoskv');
  });

  test('fails before E2E when required database URL is missing', async () => {
    const result = await runPreflight({
      env: {
        DATABASE_URL: '',
        PLATFORM_DB_URL: '',
        ZAMOSKV_DB_URL: '',
        E2E_TENANT_DB_URL: '',
        DB_PASSWORD: '',
      },
      argv: ['--e2e-access'],
      loadPg: () => {
        throw new Error('pg should not be loaded when URLs are missing');
      },
    });

    expect(result.ok).toBe(false);
    expect(result.checks.some((check) => check.status === 'missing')).toBe(true);
    expect(formatReport(result)).toContain('DATABASE_URL is required');
  });

  test('reports unreachable database with fake Pool', async () => {
    class Pool {
      async query() {
        throw new Error('ECONNREFUSED 127.0.0.1:5432');
      }

      async end() {}
    }

    const result = await runPreflight({
      env: {
        DATABASE_URL: 'postgresql://u:p@localhost:5432/app',
        PLATFORM_DB_URL: 'postgresql://u:p@localhost:5432/platform',
        ZAMOSKV_DB_URL: 'postgresql://u:p@localhost:5432/zamoskv',
      },
      argv: ['--e2e-access'],
      loadPg: () => ({ Pool }),
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(3);
    expect(result.checks.every((check) => check.status === 'unreachable')).toBe(true);
    expect(formatReport(result)).toContain('ECONNREFUSED 127.0.0.1:5432');
  });

  test('reports pending migrations with fake Pool', async () => {
    class Pool {
      async query(sql) {
        if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
        if (String(sql).startsWith('SELECT to_regclass')) {
          return { rows: [{ table_name: 'schema_migrations' }] };
        }
        if (String(sql).startsWith('SELECT id FROM schema_migrations')) {
          return { rows: [{ id: 'v1_001_buildings' }] };
        }
        throw new Error(`unexpected query ${sql}`);
      }

      async end() {}
    }

    const result = await checkDbTarget(Pool, {
      key: 'ZAMOSKV_DB_URL',
      label: 'tenant',
      required: true,
      connectionString: 'postgresql://u:p@localhost:5432/zamoskv',
      migrationTable: 'schema_migrations',
      expectedMigrationIds: ['v1_001_buildings', 'v1_002_entrances'],
    }, 3000);

    expect(result.ok).toBe(true);
    expect(result.status).toBe('migration_pending');
    expect(result.migrations.pending).toEqual(['v1_002_entrances']);
    expect(formatMigrationSummary(result.migrations)).toContain('pending 1');
    expect(formatReport({ ok: true, mode: 'tenant-ops', checks: [result] }))
      .toContain('migrations: 1/2 applied');
  });

  test('can require current migrations for post-migration gates', async () => {
    class Pool {
      async query(sql) {
        if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
        if (String(sql).startsWith('SELECT to_regclass')) {
          return { rows: [{ table_name: 'schema_migrations' }] };
        }
        if (String(sql).startsWith('SELECT id FROM schema_migrations')) {
          return { rows: [] };
        }
        throw new Error(`unexpected query ${sql}`);
      }

      async end() {}
    }

    const result = await checkDbTarget(Pool, {
      key: 'ZAMOSKV_DB_URL',
      label: 'tenant',
      required: true,
      connectionString: 'postgresql://u:p@localhost:5432/zamoskv',
      migrationTable: 'schema_migrations',
      expectedMigrationIds: ['v1_001_buildings'],
    }, 3000, { requireCurrentMigrations: true });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('migration_pending');
  });
});
