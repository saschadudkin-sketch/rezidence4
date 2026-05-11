'use strict';

const {
  parseProvisionArgs,
  runMigrationsOnPool,
  runTenantMigrationBatch,
} = require('../../../scripts/tenant-ops-core.cjs');

describe('tenant-ops-core', () => {
  test('parses and validates tenant provisioning input', () => {
    const input = parseProvisionArgs([
      '--slug', 'lesnoy-park',
      '--name', 'Lesnoy Park',
      '--db-url', 'postgresql://u:p@localhost:5432/lesnoy',
      '--plan', 'operations',
      '--property-type', 'cottage_community',
      '--hostname', 'lesnoy.domhub.local',
      '--admin-phone', '+79990000000',
      '--admin-name', 'Admin User',
      '--admin-email', 'admin@lesnoy.example',
    ], {});

    expect(input).toMatchObject({
      slug: 'lesnoy-park',
      name: 'Lesnoy Park',
      plan: 'operations',
      propertyType: 'cottage_community',
      hostname: 'lesnoy.domhub.local',
      status: 'active',
      admin: {
        uid: 'staff:lesnoy-park:property-admin',
        phone: '+79990000000',
        name: 'Admin User',
        email: 'admin@lesnoy.example',
      },
    });
  });

  test('rejects unsupported provisioning plan', () => {
    expect(() => parseProvisionArgs([
      '--slug', 'bad-plan',
      '--name', 'Bad Plan',
      '--db-url', 'postgresql://u:p@localhost:5432/bad',
      '--plan', 'premium',
    ], {})).toThrow('plan must be one of');
  });

  test('applies only pending migrations and records them', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    const pool = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
          return { rows: [] };
        }
        if (String(sql).startsWith('SELECT id FROM schema_migrations')) {
          return { rows: [{ id: '001_done' }] };
        }
        throw new Error(`unexpected pool query: ${sql}`);
      }),
      connect: jest.fn().mockResolvedValue(client),
    };
    const pendingUp = jest.fn(async (migrationClient) => {
      await migrationClient.query('ALTER TEST');
    });

    const result = await runMigrationsOnPool(pool, 'schema_migrations', [
      { id: '001_done', up: jest.fn() },
      { id: '002_pending', up: pendingUp },
    ]);

    expect(result).toMatchObject({
      applied: 1,
      skipped: 1,
      pending: [],
      dryRun: false,
    });
    expect(pool.connect).toHaveBeenCalledTimes(1);
    expect(pendingUp).toHaveBeenCalledTimes(1);
    expect(client.query).toHaveBeenCalledWith('BEGIN');
    expect(client.query).toHaveBeenCalledWith(
      'INSERT INTO schema_migrations(id) VALUES($1) ON CONFLICT (id) DO NOTHING',
      ['002_pending'],
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });

  test('dry-run migration planning does not create missing migration table', async () => {
    const pool = {
      query: jest.fn(async (sql) => {
        if (String(sql).startsWith('SELECT to_regclass')) {
          return { rows: [{ table_name: null }] };
        }
        throw new Error(`unexpected query: ${sql}`);
      }),
    };

    const result = await runMigrationsOnPool(pool, 'schema_migrations', [
      { id: '001_pending', up: jest.fn() },
    ], { dryRun: true });

    expect(result).toMatchObject({
      applied: 0,
      skipped: 0,
      pending: ['001_pending'],
      dryRun: true,
    });
    expect(pool.query.mock.calls.map((call) => call[0]).join('\n')).not.toContain('CREATE TABLE');
  });

  test('runs tenant migrations in controlled platform batches', async () => {
    const createdPools = [];
    class Pool {
      constructor({ connectionString }) {
        this.connectionString = connectionString;
        createdPools.push(this);
      }

      async query(sql) {
        const text = String(sql);
        if (text.includes('CREATE TABLE IF NOT EXISTS platform_schema_migrations')) return { rows: [] };
        if (text.startsWith('SELECT id FROM platform_schema_migrations')) return { rows: [] };
        if (text.includes('FROM properties')) {
          return {
            rows: [
              {
                id: 'property-1',
                slug: 'alpha',
                name: 'Alpha',
                db_connection_url: 'postgresql://u:p@localhost:5432/alpha',
                status: 'active',
                is_active: true,
              },
            ],
          };
        }
        if (text.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) return { rows: [] };
        if (text.startsWith('SELECT id FROM schema_migrations')) return { rows: [] };
        throw new Error(`unexpected query: ${text}`);
      }

      async connect() {
        return {
          query: jest.fn().mockResolvedValue({ rows: [] }),
          release: jest.fn(),
        };
      }

      async end() {}
    }

    const result = await runTenantMigrationBatch({
      options: {
        slugs: [],
        includeInactive: false,
        dryRun: false,
        continueOnError: false,
        batchSize: 10,
        skipPlatformMigrations: false,
      },
      env: { PLATFORM_DB_URL: 'postgresql://u:p@localhost:5432/platform' },
      Pool,
      migrations: {
        platform: [],
        tenant: [{ id: 'v1_001_alpha', up: jest.fn() }],
      },
    });

    expect(result.ok).toBe(true);
    expect(result.selected).toBe(1);
    expect(result.tenants[0]).toMatchObject({
      slug: 'alpha',
      ok: true,
      migrations: { applied: 1, skipped: 0 },
    });
    expect(createdPools.map((pool) => pool.connectionString)).toEqual([
      'postgresql://u:p@localhost:5432/platform',
      'postgresql://u:p@localhost:5432/alpha',
    ]);
  });
});
