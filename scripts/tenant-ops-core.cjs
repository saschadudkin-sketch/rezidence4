#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { repoRoot } = require('./e2e-env.cjs');

const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$/;
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const PROPERTY_TYPES = new Set(['residential_complex', 'club_house', 'cottage_community']);
const PROPERTY_STATUSES = new Set(['active', 'suspended', 'maintenance', 'terminated']);
const PROPERTY_PLANS = new Set(['core_access', 'operations', 'portfolio', 'enterprise']);
const MIGRATION_TABLES = new Set(['platform_schema_migrations', 'schema_migrations']);
const COLOR_RE = /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|[a-zA-Z]{3,20})$/;

function loadPgDefault() {
  return require(path.join(repoRoot, 'backend', 'node_modules', 'pg'));
}

function loadMigrationsDefault() {
  const { MIGRATIONS } = require(path.join(repoRoot, 'backend', 'src', 'dbMigrations'));
  const { PLATFORM_MIGRATIONS } = require(path.join(repoRoot, 'backend', 'src', 'platformMigrations'));
  const { V1_PROPERTY_MIGRATIONS } = require(path.join(repoRoot, 'backend', 'src', 'v1', 'migrations'));
  return {
    platform: PLATFORM_MIGRATIONS,
    tenant: [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS],
  };
}

function parseCliArgs(argv = []) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      args._.push(token);
      continue;
    }

    const raw = token.slice(2);
    const eq = raw.indexOf('=');
    const key = eq === -1 ? raw : raw.slice(0, eq);
    let value = eq === -1 ? true : raw.slice(eq + 1);
    if (eq === -1 && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      value = argv[i + 1];
      i += 1;
    }

    if (Object.prototype.hasOwnProperty.call(args, key)) {
      args[key] = Array.isArray(args[key]) ? [...args[key], value] : [args[key], value];
    } else {
      args[key] = value;
    }
  }
  return args;
}

function booleanArg(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  if (value === true || value === '1' || value === 'true' || value === 'yes') return true;
  if (value === false || value === '0' || value === 'false' || value === 'no') return false;
  return Boolean(value);
}

function stringArg(value, fallback = null) {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (raw === undefined || raw === null || raw === true) return fallback;
  const trimmed = String(raw).trim();
  return trimmed === '' ? fallback : trimmed;
}

function arrayArg(value) {
  if (value === undefined || value === null) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertPostgresConnectionString(value, field) {
  if (!value) throw new Error(`${field} is required`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be a valid postgresql:// URL`);
  }
  if (url.protocol !== 'postgresql:') {
    throw new Error(`${field} must start with postgresql://`);
  }
  return value;
}

function normalizeHostname(value) {
  if (value === undefined || value === null || value === '') return null;
  const hostname = String(value).trim().toLowerCase();
  if (!HOSTNAME_RE.test(hostname)) {
    throw new Error('hostname must be a lowercase DNS name like app.domhub.su');
  }
  return hostname;
}

function isValidHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeProvisionInput(raw) {
  const slug = stringArg(raw.slug);
  if (!slug || !SLUG_RE.test(slug)) {
    throw new Error('slug is required and must match ^[a-z0-9][a-z0-9-]{2,48}[a-z0-9]$');
  }

  const name = stringArg(raw.name);
  if (!name) throw new Error('name is required');

  const dbConnectionUrl = assertPostgresConnectionString(
    stringArg(raw.dbConnectionUrl),
    'dbConnectionUrl',
  );

  const plan = stringArg(raw.plan, 'core_access');
  if (!PROPERTY_PLANS.has(plan)) {
    throw new Error(`plan must be one of: ${[...PROPERTY_PLANS].join(', ')}`);
  }

  const propertyType = stringArg(raw.propertyType, 'residential_complex');
  if (!PROPERTY_TYPES.has(propertyType)) {
    throw new Error(`propertyType must be one of: ${[...PROPERTY_TYPES].join(', ')}`);
  }

  const status = stringArg(raw.status, 'active');
  if (!PROPERTY_STATUSES.has(status)) {
    throw new Error(`status must be one of: ${[...PROPERTY_STATUSES].join(', ')}`);
  }

  const admin = {
    uid: stringArg(raw.adminUid, `staff:${slug}:property-admin`),
    phone: stringArg(raw.adminPhone),
    name: stringArg(raw.adminName),
    email: stringArg(raw.adminEmail),
  };
  const hasAdminSeed = Boolean(admin.phone || admin.name || admin.email);
  if (hasAdminSeed && (!admin.phone || !admin.name || !admin.email)) {
    throw new Error('adminPhone, adminName and adminEmail are required together when seeding a property admin');
  }

  const logoUrl = stringArg(raw.logoUrl);
  if (logoUrl && !isValidHttpsUrl(logoUrl)) {
    throw new Error('logoUrl must be an https:// URL under 2048 chars');
  }

  const primaryColor = stringArg(raw.primaryColor);
  if (primaryColor && !COLOR_RE.test(primaryColor)) {
    throw new Error('primaryColor must be a CSS color like #7c3aed');
  }

  return {
    slug,
    name,
    address: stringArg(raw.address),
    dbConnectionUrl,
    plan,
    timezone: stringArg(raw.timezone, 'Europe/Moscow'),
    contactEmail: stringArg(raw.contactEmail),
    contactPhone: stringArg(raw.contactPhone),
    propertyType,
    status,
    hostname: normalizeHostname(raw.hostname),
    logoUrl,
    primaryColor,
    managementCompanyId: stringArg(raw.managementCompanyId),
    dryRun: booleanArg(raw.dryRun),
    createDatabase: booleanArg(raw.createDatabase),
    allowDbUrlChange: booleanArg(raw.allowDbUrlChange),
    skipPlatformMigrations: booleanArg(raw.skipPlatformMigrations),
    skipTenantMigrations: booleanArg(raw.skipTenantMigrations),
    admin: hasAdminSeed ? admin : null,
  };
}

function parseProvisionArgs(argv = [], env = process.env) {
  const args = parseCliArgs(argv);
  return normalizeProvisionInput({
    slug: stringArg(args.slug, env.TENANT_SLUG),
    name: stringArg(args.name, env.TENANT_NAME),
    address: stringArg(args.address, env.TENANT_ADDRESS),
    dbConnectionUrl: stringArg(args['db-url'], env.TENANT_DB_URL),
    plan: stringArg(args.plan, env.TENANT_PLAN || 'core_access'),
    timezone: stringArg(args.timezone, env.TENANT_TIMEZONE || 'Europe/Moscow'),
    contactEmail: stringArg(args['contact-email'], env.TENANT_CONTACT_EMAIL),
    contactPhone: stringArg(args['contact-phone'], env.TENANT_CONTACT_PHONE),
    propertyType: stringArg(args['property-type'], env.TENANT_PROPERTY_TYPE || 'residential_complex'),
    status: stringArg(args.status, env.TENANT_STATUS || 'active'),
    hostname: stringArg(args.hostname, env.TENANT_HOSTNAME),
    logoUrl: stringArg(args['logo-url'], env.TENANT_LOGO_URL),
    primaryColor: stringArg(args['primary-color'], env.TENANT_PRIMARY_COLOR),
    managementCompanyId: stringArg(args['management-company-id'], env.TENANT_MANAGEMENT_COMPANY_ID),
    dryRun: booleanArg(args['dry-run']) || env.TENANT_OPS_DRY_RUN === '1',
    createDatabase: booleanArg(args['create-database']) || env.TENANT_OPS_CREATE_DATABASE === '1',
    allowDbUrlChange: booleanArg(args['allow-db-url-change']) || env.TENANT_OPS_ALLOW_DB_URL_CHANGE === '1',
    skipPlatformMigrations: booleanArg(args['skip-platform-migrations']),
    skipTenantMigrations: booleanArg(args['skip-tenant-migrations']),
    adminUid: stringArg(args['admin-uid'], env.TENANT_ADMIN_UID),
    adminPhone: stringArg(args['admin-phone'], env.TENANT_ADMIN_PHONE),
    adminName: stringArg(args['admin-name'], env.TENANT_ADMIN_NAME),
    adminEmail: stringArg(args['admin-email'], env.TENANT_ADMIN_EMAIL),
  });
}

function parseBatchArgs(argv = [], env = process.env) {
  const args = parseCliArgs(argv);
  const batchSize = Number(stringArg(args['batch-size'], env.TENANT_OPS_BATCH_SIZE || '10'));
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error('batch-size must be an integer from 1 to 100');
  }

  return {
    slugs: arrayArg(args.slug),
    includeInactive: booleanArg(args['include-inactive']),
    dryRun: booleanArg(args['dry-run']) || env.TENANT_OPS_DRY_RUN === '1',
    continueOnError: booleanArg(args['continue-on-error']),
    batchSize,
    skipPlatformMigrations: booleanArg(args['skip-platform-migrations']),
  };
}

function statusToIsActive(status) {
  return status === 'active';
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function getDatabaseName(connectionString) {
  const url = new URL(connectionString);
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!name) throw new Error('tenant database URL must include a database name');
  return name;
}

function buildMaintenanceConnectionString(connectionString, database = 'postgres') {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

async function ensureDatabaseExists(Pool, connectionString, { maintenanceDatabase = 'postgres', dryRun = false } = {}) {
  const database = getDatabaseName(connectionString);
  const maintenanceConnectionString = buildMaintenanceConnectionString(connectionString, maintenanceDatabase);
  const pool = new Pool({
    connectionString: maintenanceConnectionString,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });

  try {
    const { rows } = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rows.length > 0) return { database, created: false, dryRun };
    if (!dryRun) await pool.query(`CREATE DATABASE ${quoteIdentifier(database)}`);
    return { database, created: !dryRun, dryRun };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function runMigrationsOnPool(pool, tableName, migrations, { dryRun = false } = {}) {
  if (!MIGRATION_TABLES.has(tableName)) {
    throw new Error(`Unsupported migration table ${tableName}`);
  }

  if (dryRun) {
    const tableCheck = await pool.query('SELECT to_regclass($1) AS table_name', [tableName]);
    if (!tableCheck.rows[0]?.table_name) {
      return {
        table: tableName,
        applied: 0,
        skipped: 0,
        pending: migrations.map((migration) => migration.id),
        dryRun: true,
      };
    }
  } else {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${tableName} (
        id          TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  const { rows } = await pool.query(`SELECT id FROM ${tableName}`);
  const appliedIds = new Set(rows.map((row) => row.id));
  const pending = migrations.filter((migration) => !appliedIds.has(migration.id));

  if (dryRun) {
    return {
      table: tableName,
      applied: 0,
      skipped: migrations.length - pending.length,
      pending: pending.map((migration) => migration.id),
      dryRun: true,
    };
  }

  let applied = 0;
  for (const migration of pending) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migration.up(client);
      await client.query(
        `INSERT INTO ${tableName}(id) VALUES($1) ON CONFLICT (id) DO NOTHING`,
        [migration.id],
      );
      await client.query('COMMIT');
      applied += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  return {
    table: tableName,
    applied,
    skipped: migrations.length - pending.length,
    pending: [],
    dryRun: false,
  };
}

async function upsertPlatformProperty(platformPool, input) {
  const { rows: existingRows } = await platformPool.query(
    'SELECT id, slug, db_connection_url FROM properties WHERE slug = $1',
    [input.slug],
  );
  const existing = existingRows[0] || null;
  if (existing && existing.db_connection_url !== input.dbConnectionUrl && !input.allowDbUrlChange) {
    throw new Error(
      `property ${input.slug} already points to a different db_connection_url; pass --allow-db-url-change to update it`,
    );
  }

  const values = [
    input.slug,
    input.name,
    input.address,
    input.dbConnectionUrl,
    input.plan,
    input.timezone,
    input.contactEmail,
    input.contactPhone,
    input.propertyType,
    input.status,
    statusToIsActive(input.status),
    input.hostname,
    input.logoUrl,
    input.primaryColor,
    input.managementCompanyId,
  ];

  const sql = existing
    ? `UPDATE properties
          SET name = $2,
              address = $3,
              db_connection_url = $4,
              plan = $5,
              timezone = $6,
              contact_email = $7,
              contact_phone = $8,
              property_type = $9,
              status = $10,
              is_active = $11,
              hostname = $12,
              logo_url = $13,
              primary_color = $14,
              management_company_id = $15,
              updated_at = NOW()
        WHERE slug = $1
        RETURNING *`
    : `INSERT INTO properties
         (slug, name, address, db_connection_url, plan, timezone,
          contact_email, contact_phone, property_type, status, is_active,
          hostname, logo_url, primary_color, management_company_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`;

  const { rows } = await platformPool.query(sql, values);
  const property = rows[0];
  await platformPool.query(
    `INSERT INTO platform_audit_log (actor_type, action, property_id, details)
     VALUES ($1, $2, $3, $4)`,
    [
      'system',
      existing ? 'tenant.provisioning_updated' : 'tenant.provisioned',
      property.id,
      JSON.stringify({
        slug: input.slug,
        plan: input.plan,
        property_type: input.propertyType,
        status: input.status,
        hostname: input.hostname,
        source: 'tenant-ops-provision',
      }),
    ],
  );

  return { action: existing ? 'updated' : 'created', property };
}

async function seedPropertyAdmin(tenantPool, propertyId, propertySlug, admin) {
  if (!admin) return null;

  await tenantPool.query(
    `INSERT INTO users (uid, phone, name, role, apartment, property_slug)
     VALUES ($1, $2, $3, 'admin', NULL, $4)
     ON CONFLICT (uid) DO UPDATE
       SET phone = EXCLUDED.phone,
           name = EXCLUDED.name,
           role = 'admin',
           property_slug = EXCLUDED.property_slug`,
    [admin.uid, admin.phone, admin.name, propertySlug],
  );

  const { rows: existingRows } = await tenantPool.query(
    `SELECT id FROM staff_users
      WHERE property_id = $1 AND LOWER(email) = LOWER($2)
      LIMIT 1`,
    [propertyId, admin.email],
  );

  if (existingRows.length) {
    const { rows } = await tenantPool.query(
      `UPDATE staff_users
          SET external_uid = $2,
              full_name = $3,
              phone = $4,
              role = 'property_admin',
              is_active = true,
              can_view_resident_phone = true,
              can_assign_requests = true,
              updated_at = NOW()
        WHERE id = $1
        RETURNING id`,
      [existingRows[0].id, admin.uid, admin.name, admin.phone],
    );
    return { action: 'updated', staffId: rows[0].id, uid: admin.uid };
  }

  const { rows } = await tenantPool.query(
    `INSERT INTO staff_users
       (property_id, external_uid, full_name, phone, email, role, is_active,
        can_view_resident_phone, can_assign_requests)
     VALUES ($1, $2, $3, $4, $5, 'property_admin', true, true, true)
     RETURNING id`,
    [propertyId, admin.uid, admin.name, admin.phone, admin.email],
  );
  return { action: 'created', staffId: rows[0].id, uid: admin.uid };
}

async function provisionTenant({
  input,
  env = process.env,
  Pool = loadPgDefault().Pool,
  migrations = loadMigrationsDefault(),
} = {}) {
  if (!input) throw new Error('input is required');
  const platformDbUrl = env.PLATFORM_DB_URL;
  assertPostgresConnectionString(platformDbUrl, 'PLATFORM_DB_URL');

  const database = input.createDatabase
    ? await ensureDatabaseExists(Pool, input.dbConnectionUrl, { dryRun: input.dryRun })
    : null;

  const platformPool = new Pool({
    connectionString: platformDbUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });
  const tenantPool = new Pool({
    connectionString: input.dbConnectionUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });

  try {
    const platformMigrations = input.skipPlatformMigrations
      ? null
      : await runMigrationsOnPool(platformPool, 'platform_schema_migrations', migrations.platform, {
        dryRun: input.dryRun,
      });
    const tenantMigrations = input.skipTenantMigrations
      ? null
      : await runMigrationsOnPool(tenantPool, 'schema_migrations', migrations.tenant, {
        dryRun: input.dryRun,
      });

    if (input.dryRun) {
      return {
        ok: true,
        dryRun: true,
        database,
        platformMigrations,
        tenantMigrations,
        property: null,
        admin: null,
      };
    }

    const property = await upsertPlatformProperty(platformPool, input);
    const admin = await seedPropertyAdmin(tenantPool, property.property.id, input.slug, input.admin);
    return {
      ok: true,
      dryRun: false,
      database,
      platformMigrations,
      tenantMigrations,
      property,
      admin,
    };
  } finally {
    await Promise.all([
      platformPool.end().catch(() => {}),
      tenantPool.end().catch(() => {}),
    ]);
  }
}

async function listTenantProperties(platformPool, options) {
  const params = [];
  const where = [];
  if (options.slugs.length > 0) {
    params.push(options.slugs);
    where.push(`slug = ANY($${params.length})`);
  }
  if (!options.includeInactive) {
    where.push("is_active = true AND COALESCE(status, 'active') = 'active'");
  }
  params.push(options.batchSize);
  const sql = `
    SELECT id, slug, name, db_connection_url, status, is_active
      FROM properties
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY slug
     LIMIT $${params.length}
  `;
  const { rows } = await platformPool.query(sql, params);
  return rows;
}

async function runTenantMigrationBatch({
  options,
  env = process.env,
  Pool = loadPgDefault().Pool,
  migrations = loadMigrationsDefault(),
} = {}) {
  if (!options) throw new Error('options is required');
  const platformDbUrl = env.PLATFORM_DB_URL;
  assertPostgresConnectionString(platformDbUrl, 'PLATFORM_DB_URL');

  const platformPool = new Pool({
    connectionString: platformDbUrl,
    max: 1,
    idleTimeoutMillis: 1000,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30000,
  });

  try {
    const platformMigrations = options.skipPlatformMigrations
      ? null
      : await runMigrationsOnPool(platformPool, 'platform_schema_migrations', migrations.platform, {
        dryRun: options.dryRun,
      });
    const properties = await listTenantProperties(platformPool, options);
    const tenants = [];

    for (const property of properties) {
      const tenantPool = new Pool({
        connectionString: property.db_connection_url,
        max: 1,
        idleTimeoutMillis: 1000,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
      });
      try {
        const tenantMigrations = await runMigrationsOnPool(tenantPool, 'schema_migrations', migrations.tenant, {
          dryRun: options.dryRun,
        });
        tenants.push({
          slug: property.slug,
          ok: true,
          migrations: tenantMigrations,
        });
      } catch (err) {
        tenants.push({
          slug: property.slug,
          ok: false,
          error: err.message,
        });
        if (!options.continueOnError) break;
      } finally {
        await tenantPool.end().catch(() => {});
      }
    }

    return {
      ok: tenants.every((tenant) => tenant.ok),
      dryRun: options.dryRun,
      platformMigrations,
      selected: properties.length,
      tenants,
    };
  } finally {
    await platformPool.end().catch(() => {});
  }
}

function formatMigrationResult(result) {
  if (!result) return 'skipped';
  const pending = result.pending.length;
  const suffix = pending ? `, pending ${pending}` : '';
  return `${result.applied} applied, ${result.skipped} skipped${suffix}`;
}

function formatProvisionReport(result) {
  const lines = ['[tenant-ops-provision] completed'];
  if (result.dryRun) lines[0] = '[tenant-ops-provision] dry run completed';
  if (result.database) {
    lines.push(`database: ${result.database.database} ${result.database.created ? 'created' : 'already exists'}`);
  }
  lines.push(`platform migrations: ${formatMigrationResult(result.platformMigrations)}`);
  lines.push(`tenant migrations: ${formatMigrationResult(result.tenantMigrations)}`);
  if (result.property) {
    lines.push(`property: ${result.property.action} ${result.property.property.slug} (${result.property.property.id})`);
  }
  if (result.admin) {
    lines.push(`admin: ${result.admin.action} ${result.admin.uid} (${result.admin.staffId})`);
  }
  return lines.join('\n');
}

function formatBatchReport(result) {
  const lines = [result.dryRun ? '[tenant-ops-migrate] dry run completed' : '[tenant-ops-migrate] completed'];
  lines.push(`platform migrations: ${formatMigrationResult(result.platformMigrations)}`);
  lines.push(`selected tenants: ${result.selected}`);
  for (const tenant of result.tenants) {
    if (tenant.ok) {
      lines.push(`- ${tenant.slug}: ${formatMigrationResult(tenant.migrations)}`);
    } else {
      lines.push(`- ${tenant.slug}: failed: ${tenant.error}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  buildMaintenanceConnectionString,
  ensureDatabaseExists,
  formatBatchReport,
  formatMigrationResult,
  formatProvisionReport,
  getDatabaseName,
  listTenantProperties,
  normalizeProvisionInput,
  parseBatchArgs,
  parseCliArgs,
  parseProvisionArgs,
  provisionTenant,
  quoteIdentifier,
  runMigrationsOnPool,
  runTenantMigrationBatch,
  seedPropertyAdmin,
  statusToIsActive,
  upsertPlatformProperty,
};
