'use strict';

const path = require('path');
const { buildE2EEnv } = require(path.resolve(__dirname, '..', '..', '..', 'scripts', 'e2e-env.cjs'));

Object.assign(process.env, buildE2EEnv(process.env));

const { Pool } = require('pg');
const { MIGRATIONS } = require('../dbMigrations');
const { PLATFORM_MIGRATIONS } = require('../platformMigrations');
const { V1_PROPERTY_MIGRATIONS } = require('../v1/migrations');

const PROPERTY_SLUG = process.env.E2E_PROPERTY_SLUG || 'zamoskv';
const PROPERTY_NAME = 'E2E Резиденции Замоскворечья';
const PROPERTY_TYPE = process.env.E2E_PROPERTY_TYPE || 'residential_complex';

const USERS = {
  resident: {
    uid: 'e2e-v1-resident',
    phone: '+79005550101',
    name: 'E2E Resident',
    role: 'owner',
    apartment: '101',
  },
  concierge: {
    uid: 'e2e-v1-concierge',
    phone: '+79005550102',
    name: 'E2E Concierge',
    role: 'concierge',
    apartment: null,
  },
  security: {
    uid: 'e2e-v1-security',
    phone: '+79005550103',
    name: 'E2E Security',
    role: 'security',
    apartment: null,
  },
  admin: {
    uid: 'e2e-v1-admin',
    phone: '+79005550104',
    name: 'E2E Property Admin',
    role: 'admin',
    apartment: null,
  },
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for v1 access e2e seed`);
  return value;
}

function makePool(connectionString, label) {
  const pool = new Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.warn(`[seed:v1-access] ${label} pool error: ${err.message}`);
  });
  return pool;
}

async function runMigrations(pool, tableName, migrations) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows } = await pool.query(`SELECT id FROM ${tableName}`);
  const applied = new Set(rows.map((row) => row.id));

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query(`INSERT INTO ${tableName}(id) VALUES($1)`, [migration.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}

async function upsertPlatformProperty(platformPool, tenantDbUrl) {
  const { rows } = await platformPool.query(
    `INSERT INTO properties (slug, name, address, db_connection_url, is_active, plan, contact_email, property_type)
     VALUES ($1, $2, $3, $4, true, 'operations', 'e2e@domhub.local', $5)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       db_connection_url = EXCLUDED.db_connection_url,
       is_active = true,
       plan = EXCLUDED.plan,
       property_type = EXCLUDED.property_type,
       updated_at = NOW()
     RETURNING id, slug, db_connection_url, property_type`,
    [
      PROPERTY_SLUG,
      PROPERTY_NAME,
      'E2E tenant property',
      tenantDbUrl,
      PROPERTY_TYPE,
    ],
  );
  return rows[0];
}

async function upsertLegacyUsers(pool) {
  for (const user of Object.values(USERS)) {
    await pool.query(
      `INSERT INTO users (uid, phone, name, role, apartment, property_slug)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (uid) DO UPDATE SET
         phone = EXCLUDED.phone,
         name = EXCLUDED.name,
         role = EXCLUDED.role,
         apartment = EXCLUDED.apartment,
         property_slug = EXCLUDED.property_slug,
         deleted_at = NULL`,
      [user.uid, user.phone, user.name, user.role, user.apartment, PROPERTY_SLUG],
    );
  }
}

async function upsertStaff(tenantPool, propertyId, user, role, email) {
  const existing = await tenantPool.query(
    `SELECT id FROM staff_users WHERE external_uid = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
    [user.uid, email],
  );

  if (existing.rows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE staff_users SET
         property_id = $1,
         external_uid = $2,
         full_name = $3,
         phone = $4,
         email = $5,
         role = $6,
         is_active = true,
         can_view_resident_phone = $7,
         can_assign_requests = $8,
         updated_at = NOW()
       WHERE id = $9
       RETURNING id`,
      [
        propertyId,
        user.uid,
        user.name,
        user.phone,
        email,
        role,
        role === 'concierge',
        role === 'concierge',
        existing.rows[0].id,
      ],
    );
    return rows[0].id;
  }

  const { rows } = await tenantPool.query(
    `INSERT INTO staff_users
       (property_id, external_uid, full_name, phone, email, role,
        is_active, can_view_resident_phone, can_assign_requests)
     VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
     RETURNING id`,
    [
      propertyId,
      user.uid,
      user.name,
      user.phone,
      email,
      role,
      role === 'concierge',
      role === 'concierge',
    ],
  );
  return rows[0].id;
}

async function seedTenant(tenantPool, propertyId) {
  const { rows: buildingRows } = await tenantPool.query(
    `INSERT INTO buildings (property_id, code, name, sort_order)
     VALUES ($1, 'e2e-main', 'E2E Main Building', 1)
     ON CONFLICT (property_id, code) WHERE code IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [propertyId],
  );
  const buildingId = buildingRows[0].id;

  const { rows: entranceRows } = await tenantPool.query(
    `INSERT INTO entrances (building_id, code, name, sort_order)
     VALUES ($1, 'e2e-a', 'E2E Entrance A', 1)
     ON CONFLICT (building_id, code) WHERE code IS NOT NULL
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [buildingId],
  );
  const entranceId = entranceRows[0].id;

  const { rows: unitRows } = await tenantPool.query(
    `INSERT INTO units (property_id, building_id, entrance_id, unit_number, unit_type, floor, is_active)
     VALUES ($1, $2, $3, '101', 'apartment', 10, true)
     ON CONFLICT (property_id, building_id, entrance_id, unit_number)
     DO UPDATE SET is_active = true, updated_at = NOW()
     RETURNING id`,
    [propertyId, buildingId, entranceId],
  );
  const unitId = unitRows[0].id;

  const { rows: residentRows } = await tenantPool.query(
    `INSERT INTO residents
       (external_uid, property_id, unit_id, full_name, phone, email,
        role, resident_type, is_active, consent_given_at, consent_version)
     VALUES ($1, $2, $3, $4, $5, 'resident.e2e@domhub.local',
             'resident', 'owner', true, NOW(), 'e2e')
     ON CONFLICT (external_uid) DO UPDATE SET
       property_id = EXCLUDED.property_id,
       unit_id = EXCLUDED.unit_id,
       full_name = EXCLUDED.full_name,
       phone = EXCLUDED.phone,
       is_active = true,
       updated_at = NOW()
     RETURNING id`,
    [
      USERS.resident.uid,
      propertyId,
      unitId,
      USERS.resident.name,
      USERS.resident.phone,
    ],
  );
  const residentId = residentRows[0].id;

  const conciergeId = await upsertStaff(
    tenantPool,
    propertyId,
    USERS.concierge,
    'concierge',
    'concierge.e2e@domhub.local',
  );
  const securityId = await upsertStaff(
    tenantPool,
    propertyId,
    USERS.security,
    'security',
    'security.e2e@domhub.local',
  );

  const { rows: requestRows } = await tenantPool.query(
    `SELECT id FROM access_requests WHERE created_by_resident_id = $1`,
    [residentId],
  );
  const requestIds = requestRows.map((row) => row.id);
  if (requestIds.length > 0) {
    await tenantPool.query(
      `DELETE FROM access_incidents
        WHERE related_pass_id IN (
          SELECT id FROM passes WHERE access_request_id = ANY($1::uuid[])
        )`,
      [requestIds],
    );
    await tenantPool.query(
      `DELETE FROM visit_logs_v2
        WHERE pass_id IN (
          SELECT id FROM passes WHERE access_request_id = ANY($1::uuid[])
        )`,
      [requestIds],
    );
    await tenantPool.query(
      `DELETE FROM qr_passes_v2
        WHERE pass_id IN (
          SELECT id FROM passes WHERE access_request_id = ANY($1::uuid[])
        )`,
      [requestIds],
    );
    await tenantPool.query(
      `DELETE FROM passes WHERE access_request_id = ANY($1::uuid[])`,
      [requestIds],
    );
    await tenantPool.query(
      `DELETE FROM access_approvals WHERE access_request_id = ANY($1::uuid[])`,
      [requestIds],
    );
    await tenantPool.query(
      `DELETE FROM access_requests WHERE id = ANY($1::uuid[])`,
      [requestIds],
    );
  }

  const guestPolicyName = 'E2E Guest QR auto';
  await tenantPool.query(
    `DELETE FROM access_policies
      WHERE property_id = $1
        AND LOWER(name) = LOWER($2)`,
    [propertyId, guestPolicyName],
  );
  await tenantPool.query(
    `INSERT INTO access_policies
       (property_id, name, subject_type, access_method, approval_mode, effect,
        priority, is_recurring, metadata)
     VALUES ($1,$2,'guest','qr','auto','allow',-1000,true,$3::jsonb)`,
    [propertyId, guestPolicyName, JSON.stringify({ e2e: true, use_case: 'guest_qr_auto' })],
  );

  const vehiclePolicyName = 'E2E Resident vehicle plate auto';
  await tenantPool.query(
    `DELETE FROM access_policies
      WHERE property_id = $1
        AND LOWER(name) = LOWER($2)`,
    [propertyId, vehiclePolicyName],
  );
  await tenantPool.query(
    `INSERT INTO access_policies
       (property_id, name, subject_type, access_method, approval_mode, effect,
        priority, is_recurring, metadata)
     VALUES ($1,$2,'vehicle','plate','auto','allow',-900,true,$3::jsonb)`,
    [propertyId, vehiclePolicyName, JSON.stringify({ e2e: true, use_case: 'resident_vehicle_plate_auto' })],
  );

  return { propertyId, buildingId, entranceId, unitId, residentId, conciergeId, securityId };
}

async function main() {
  const globalDbUrl = requireEnv('DATABASE_URL');
  const platformDbUrl = requireEnv('PLATFORM_DB_URL');
  const tenantDbUrl = process.env.ZAMOSKV_DB_URL || process.env.E2E_TENANT_DB_URL || globalDbUrl;

  const globalPool = makePool(globalDbUrl, 'global');
  const platformPool = makePool(platformDbUrl, 'platform');
  const tenantPool = makePool(tenantDbUrl, 'tenant');

  try {
    await runMigrations(platformPool, 'platform_schema_migrations', PLATFORM_MIGRATIONS);
    const property = await upsertPlatformProperty(platformPool, tenantDbUrl);
    await runMigrations(tenantPool, 'schema_migrations', [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS]);
    await upsertLegacyUsers(globalPool);
    await upsertLegacyUsers(tenantPool);
    const seeded = await seedTenant(tenantPool, property.id);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ok: true,
      property_slug: PROPERTY_SLUG,
      property_type: property.property_type,
      ...seeded,
      users: USERS,
    }, null, 2));
  } finally {
    await Promise.allSettled([
      globalPool.end(),
      platformPool.end(),
      tenantPool.end(),
    ]);
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[seed:v1-access] ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  main,
  USERS,
  PROPERTY_SLUG,
  PROPERTY_TYPE,
};
