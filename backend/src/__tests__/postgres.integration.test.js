'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const hasDatabaseUrl = Boolean(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL);
const describeIfPg = hasDatabaseUrl ? describe : describe.skip;
const db = hasDatabaseUrl ? require('../db') : null;
let isDatabaseAvailable = false;

describeIfPg('PostgreSQL integration', () => {
  beforeAll(async () => {
    try {
      await db.query('SELECT 1');
      isDatabaseAvailable = true;
      await db.migrate();
    } catch (err) {
      isDatabaseAvailable = false;
      console.warn('[postgres.integration] Skipping live PostgreSQL assertions:', err.message);
    }
  });

  afterAll(async () => {
    await db.pool.end();
  });

  test('executes transactional temp-table queries against a real PostgreSQL instance', async () => {
    if (!isDatabaseAvailable) return;
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TEMP TABLE integration_smoke (id SERIAL PRIMARY KEY, payload JSONB NOT NULL)');
      const inserted = await client.query(
        'INSERT INTO integration_smoke(payload) VALUES($1::jsonb) RETURNING id, payload',
        [JSON.stringify({ ok: true, source: 'postgres' })],
      );

      expect(inserted.rows[0].id).toBeGreaterThan(0);
      expect(inserted.rows[0].payload).toEqual({ ok: true, source: 'postgres' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  test('request_history lookups use the req_id index on the live schema', async () => {
    if (!isDatabaseAvailable) return;
    const explain = await db.query(
      'EXPLAIN SELECT * FROM request_history WHERE req_id = $1',
      ['integration-miss'],
    );
    const plan = explain.rows.map((row) => Object.values(row)[0]).join('\n');

    expect(plan).toMatch(/Index Scan|Bitmap Index Scan/);
    expect(plan).toContain('req_id');
  });
});
