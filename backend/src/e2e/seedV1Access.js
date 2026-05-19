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
const REQUIRED_FEATURE_FLAGS = {
  qr_pass: true,
  public_pass_v1: true,
  security_workspace_enriched: true,
  guard_authorized_devices: false,
};
const MANAGEMENT_COMPANY = {
  slug: 'e2e-management-company',
  name: 'E2E Management Company',
  email: 'mc.e2e@domhub.local',
};
const CANONICAL = {
  zoneName: 'E2E Canonical Perimeter',
  pointName: 'E2E Canonical Checkpoint',
  residentPlate: 'E2E101',
  contractorPlate: 'E2E202',
  contractorCompany: 'E2E Contractor Company',
  contractorReason: 'E2E canonical contractor access',
  providerEventId: 'e2e-canonical-visit-log',
  outboxEventType: 'e2e.seed.ready',
  auditAction: 'e2e.seed.canonical_ready',
};

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
  technician: {
    uid: 'e2e-v1-technician',
    phone: '+79005550105',
    name: 'E2E Technician',
    role: 'technician',
    apartment: null,
  },
  contractor: {
    uid: 'e2e-v1-contractor',
    phone: '+79005550106',
    name: 'E2E Contractor',
    role: 'contractor',
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

async function upsertManagementCompany(platformPool) {
  const { rows } = await platformPool.query(
    `INSERT INTO management_companies (slug, name, contact_email, status)
     VALUES ($1, $2, $3, 'active')
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       contact_email = EXCLUDED.contact_email,
       status = 'active',
       updated_at = NOW()
     RETURNING id`,
    [MANAGEMENT_COMPANY.slug, MANAGEMENT_COMPANY.name, MANAGEMENT_COMPANY.email],
  );
  const managementCompanyId = rows[0].id;

  await platformPool.query(
    `INSERT INTO management_company_admins
       (management_company_id, email, password_hash, name, is_active)
     VALUES ($1, $2, 'e2e-not-for-login', 'E2E MC Admin', true)
     ON CONFLICT (management_company_id, email) DO UPDATE SET
       name = EXCLUDED.name,
       is_active = true`,
    [managementCompanyId, 'mc-admin.e2e@domhub.local'],
  );

  return managementCompanyId;
}

async function upsertPlatformProperty(platformPool, tenantDbUrl, managementCompanyId) {
  const { rows } = await platformPool.query(
    `INSERT INTO properties
       (slug, name, address, db_connection_url, is_active, plan, contact_email,
        property_type, feature_flags, management_company_id)
     VALUES ($1, $2, $3, $4, true, 'operations', 'e2e@domhub.local', $5, $6::jsonb, $7)
     ON CONFLICT (slug) DO UPDATE SET
       name = EXCLUDED.name,
       db_connection_url = EXCLUDED.db_connection_url,
       is_active = true,
       plan = EXCLUDED.plan,
       property_type = EXCLUDED.property_type,
       feature_flags = COALESCE(properties.feature_flags, '{}'::jsonb) || EXCLUDED.feature_flags,
       management_company_id = EXCLUDED.management_company_id,
       updated_at = NOW()
     RETURNING id, slug, db_connection_url, property_type, management_company_id`,
    [
      PROPERTY_SLUG,
      PROPERTY_NAME,
      'E2E tenant property',
      tenantDbUrl,
      PROPERTY_TYPE,
      JSON.stringify(REQUIRED_FEATURE_FLAGS),
      managementCompanyId,
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

async function upsertContractor(tenantPool, propertyId) {
  const { rows: companyRows } = await tenantPool.query(
    `INSERT INTO contractor_companies
       (property_id, name, contact_name, contact_phone, contact_email, status)
     VALUES ($1, $2, 'E2E Contractor Manager', '+79005550160', 'contractor-company.e2e@domhub.local', 'active')
     ON CONFLICT (property_id, LOWER(name)) DO UPDATE SET
       contact_name = EXCLUDED.contact_name,
       contact_phone = EXCLUDED.contact_phone,
       contact_email = EXCLUDED.contact_email,
       status = 'active',
       updated_at = NOW()
     RETURNING id`,
    [propertyId, CANONICAL.contractorCompany],
  );
  const contractorCompanyId = companyRows[0].id;

  const existing = await tenantPool.query(
    `SELECT id FROM contractor_users WHERE external_uid = $1 OR LOWER(email) = LOWER($2) LIMIT 1`,
    [USERS.contractor.uid, 'contractor.e2e@domhub.local'],
  );

  if (existing.rows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE contractor_users SET
         contractor_company_id = $1,
         property_id = $2,
         external_uid = $3,
         full_name = $4,
         phone = $5,
         email = 'contractor.e2e@domhub.local',
         specialization = 'maintenance',
         is_active = true,
         access_expires_at = NOW() + INTERVAL '90 days',
         updated_at = NOW()
       WHERE id = $6
       RETURNING id`,
      [
        contractorCompanyId,
        propertyId,
        USERS.contractor.uid,
        USERS.contractor.name,
        USERS.contractor.phone,
        existing.rows[0].id,
      ],
    );
    return { contractorCompanyId, contractorUserId: rows[0].id };
  }

  const { rows } = await tenantPool.query(
    `INSERT INTO contractor_users
       (contractor_company_id, property_id, external_uid, full_name, phone, email,
        specialization, is_active, access_expires_at)
     VALUES ($1, $2, $3, $4, $5, 'contractor.e2e@domhub.local',
             'maintenance', true, NOW() + INTERVAL '90 days')
     RETURNING id`,
    [
      contractorCompanyId,
      propertyId,
      USERS.contractor.uid,
      USERS.contractor.name,
      USERS.contractor.phone,
    ],
  );

  return { contractorCompanyId, contractorUserId: rows[0].id };
}

async function upsertRoleMembership(tenantPool, {
  propertyId,
  residentId = null,
  staffUserId = null,
  contractorUserId = null,
  role,
  createdByStaffId = null,
}) {
  const subjectColumn = residentId
    ? 'resident_id'
    : staffUserId
      ? 'staff_user_id'
      : 'contractor_user_id';
  const subjectId = residentId || staffUserId || contractorUserId;

  const existing = await tenantPool.query(
    `SELECT id FROM role_scope_memberships
      WHERE property_id = $1
        AND ${subjectColumn} = $2
        AND role = $3
        AND scope_level = 'property'
        AND status = 'active'
      LIMIT 1`,
    [propertyId, subjectId, role],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const { rows } = await tenantPool.query(
    `INSERT INTO role_scope_memberships
       (property_id, resident_id, staff_user_id, contractor_user_id, role,
        scope_level, scope_id, status, created_by_staff_id)
     VALUES ($1, $2, $3, $4, $5, 'property', NULL, 'active', $6)
     RETURNING id`,
    [propertyId, residentId, staffUserId, contractorUserId, role, createdByStaffId],
  );
  return rows[0].id;
}

async function upsertAccessTopology(tenantPool, propertyId, buildingId) {
  const { rows: existingZoneRows } = await tenantPool.query(
    `SELECT id FROM access_zones
      WHERE property_id = $1 AND LOWER(name) = LOWER($2)
      LIMIT 1`,
    [propertyId, CANONICAL.zoneName],
  );

  let zoneId;
  if (existingZoneRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE access_zones SET
         building_id = $1,
         zone_type = 'perimeter',
         description = 'Canonical E2E perimeter zone',
         is_active = true,
         sort_order = 10,
         metadata = $2::jsonb,
         updated_at = NOW()
       WHERE id = $3
       RETURNING id`,
      [buildingId, JSON.stringify({ e2e: true, canonical: true }), existingZoneRows[0].id],
    );
    zoneId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO access_zones
         (property_id, building_id, name, zone_type, description, is_active, sort_order, metadata)
       VALUES ($1, $2, $3, 'perimeter', 'Canonical E2E perimeter zone', true, 10, $4::jsonb)
       RETURNING id`,
      [propertyId, buildingId, CANONICAL.zoneName, JSON.stringify({ e2e: true, canonical: true })],
    );
    zoneId = rows[0].id;
  }

  const { rows: existingPointRows } = await tenantPool.query(
    `SELECT id FROM access_points
      WHERE property_id = $1
        AND provider = 'domhub-e2e'
        AND provider_external_id = 'canonical-checkpoint'
      LIMIT 1`,
    [propertyId],
  );

  let pointId;
  if (existingPointRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE access_points SET
         zone_id = $1,
         name = $2,
         point_type = 'checkpoint',
         description = 'Canonical E2E checkpoint',
         is_active = true,
         sort_order = 10,
         metadata = $3::jsonb,
         updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [zoneId, CANONICAL.pointName, JSON.stringify({ e2e: true, canonical: true }), existingPointRows[0].id],
    );
    pointId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO access_points
         (property_id, zone_id, name, point_type, provider, provider_external_id,
          description, is_active, sort_order, metadata)
       VALUES ($1, $2, $3, 'checkpoint', 'domhub-e2e', 'canonical-checkpoint',
               'Canonical E2E checkpoint', true, 10, $4::jsonb)
       RETURNING id`,
      [propertyId, zoneId, CANONICAL.pointName, JSON.stringify({ e2e: true, canonical: true })],
    );
    pointId = rows[0].id;
  }

  return { zoneId, pointId };
}

async function upsertVehicle(tenantPool, {
  propertyId,
  plate,
  ownerType,
  residentId = null,
  staffId = null,
  contractorUserId = null,
  brand,
  model,
  vehicleType = 'car',
  isWhitelisted = true,
  notes,
}) {
  const { rows } = await tenantPool.query(
    `INSERT INTO vehicles
       (property_id, owner_type, owner_resident_id, owner_staff_id,
        owner_contractor_user_id, plate_number, vehicle_type, brand, model,
        is_whitelisted, is_blacklisted, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, false, $11)
     ON CONFLICT (property_id, plate_number) DO UPDATE SET
       owner_type = EXCLUDED.owner_type,
       owner_resident_id = EXCLUDED.owner_resident_id,
       owner_staff_id = EXCLUDED.owner_staff_id,
       owner_contractor_user_id = EXCLUDED.owner_contractor_user_id,
       vehicle_type = EXCLUDED.vehicle_type,
       brand = EXCLUDED.brand,
       model = EXCLUDED.model,
       is_whitelisted = EXCLUDED.is_whitelisted,
       is_blacklisted = false,
       notes = EXCLUDED.notes,
       updated_at = NOW()
     RETURNING id`,
    [
      propertyId,
      ownerType,
      residentId,
      staffId,
      contractorUserId,
      plate,
      vehicleType,
      brand,
      model,
      isWhitelisted,
      notes,
    ],
  );
  return rows[0].id;
}

async function seedCanonicalAccessSamples(tenantPool, {
  propertyId,
  residentId,
  securityId,
  contractorUserId,
  residentVehicleId,
  contractorVehicleId,
  zoneId,
  pointId,
}) {
  const { rows: requestRows } = await tenantPool.query(
    `SELECT id FROM access_requests
      WHERE property_id = $1
        AND created_by_contractor_user_id = $2
        AND reason = $3
      LIMIT 1`,
    [propertyId, contractorUserId, CANONICAL.contractorReason],
  );

  let accessRequestId;
  if (requestRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE access_requests SET
         request_type = 'contractor_access',
         vehicle_id = $1,
         target_zone_id = $2,
         target_point_id = $3,
         starts_at = NOW() - INTERVAL '10 minutes',
         ends_at = NOW() + INTERVAL '8 hours',
         status = 'approved',
         approval_required = false,
         approved_at = COALESCE(approved_at, NOW()),
         updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [contractorVehicleId, zoneId, pointId, requestRows[0].id],
    );
    accessRequestId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO access_requests
         (property_id, created_by_type, created_by_contractor_user_id,
          request_type, visitor_name, vehicle_id, target_zone_id, target_point_id,
          reason, starts_at, ends_at, status, approval_required, approved_at)
       VALUES ($1, 'contractor', $2, 'contractor_access', 'E2E Contractor Crew',
               $3, $4, $5, $6, NOW() - INTERVAL '10 minutes',
               NOW() + INTERVAL '8 hours', 'approved', false, NOW())
       RETURNING id`,
      [propertyId, contractorUserId, contractorVehicleId, zoneId, pointId, CANONICAL.contractorReason],
    );
    accessRequestId = rows[0].id;
  }

  const { rows: passRows } = await tenantPool.query(
    `SELECT id FROM passes
      WHERE property_id = $1
        AND access_request_id = $2
        AND pass_type = 'contractor'
      LIMIT 1`,
    [propertyId, accessRequestId],
  );

  let passId;
  if (passRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE passes SET
         subject_type = 'contractor_user',
         subject_contractor_user_id = $1,
         zone_id = $2,
         point_id = $3,
         valid_from = NOW() - INTERVAL '10 minutes',
         valid_until = NOW() + INTERVAL '8 hours',
         status = 'active',
         approved_by_staff_id = $4
       WHERE id = $5
       RETURNING id`,
      [contractorUserId, zoneId, pointId, securityId, passRows[0].id],
    );
    passId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO passes
         (property_id, access_request_id, pass_type, subject_type,
          subject_contractor_user_id, zone_id, point_id, valid_from, valid_until,
          status, approved_by_staff_id)
       VALUES ($1, $2, 'contractor', 'contractor_user', $3, $4, $5,
               NOW() - INTERVAL '10 minutes', NOW() + INTERVAL '8 hours',
               'active', $6)
       RETURNING id`,
      [propertyId, accessRequestId, contractorUserId, zoneId, pointId, securityId],
    );
    passId = rows[0].id;
  }

  const { rows: visitRows } = await tenantPool.query(
    `INSERT INTO visit_logs_v2
       (property_id, pass_id, access_point_id, event_type, event_source,
        person_label, vehicle_plate, performed_by_staff_id, provider_event_id,
        provider_payload, occurred_at, degraded_mode, degraded_reconciliation_state)
     VALUES ($1, $2, $3, 'manual_admit', 'import', 'E2E Contractor Crew',
             $4, $5, $6, $7::jsonb, NOW(), false, 'not_required')
     ON CONFLICT (event_source, provider_event_id) WHERE provider_event_id IS NOT NULL
     DO UPDATE SET
       property_id = EXCLUDED.property_id,
       pass_id = EXCLUDED.pass_id,
       access_point_id = EXCLUDED.access_point_id,
       person_label = EXCLUDED.person_label,
       vehicle_plate = EXCLUDED.vehicle_plate,
       performed_by_staff_id = EXCLUDED.performed_by_staff_id,
       provider_payload = EXCLUDED.provider_payload,
       occurred_at = NOW()
     RETURNING id`,
    [
      propertyId,
      passId,
      pointId,
      CANONICAL.contractorPlate,
      securityId,
      CANONICAL.providerEventId,
      JSON.stringify({ e2e: true, canonical: true, direction: 'entry' }),
    ],
  );
  const visitLogId = visitRows[0].id;

  const { rows: incidentRows } = await tenantPool.query(
    `SELECT id FROM access_incidents
      WHERE property_id = $1
        AND related_visit_log_id = $2
        AND incident_type = 'manual_override'
      LIMIT 1`,
    [propertyId, visitLogId],
  );

  let incidentId;
  if (incidentRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE access_incidents SET
         related_pass_id = $1,
         related_vehicle_id = $2,
         severity = 'low',
         status = 'resolved',
         title = 'E2E canonical manual admit',
         description = 'Seeded canonical manual-admit evidence',
         created_by_staff_id = $3,
         assigned_to_staff_id = $3,
         resolved_at = COALESCE(resolved_at, NOW()),
         updated_at = NOW()
       WHERE id = $4
       RETURNING id`,
      [passId, contractorVehicleId, securityId, incidentRows[0].id],
    );
    incidentId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO access_incidents
         (property_id, related_pass_id, related_visit_log_id, related_vehicle_id,
          incident_type, severity, status, title, description,
          created_by_staff_id, assigned_to_staff_id, resolved_at)
       VALUES ($1, $2, $3, $4, 'manual_override', 'low', 'resolved',
               'E2E canonical manual admit', 'Seeded canonical manual-admit evidence',
               $5, $5, NOW())
       RETURNING id`,
      [propertyId, passId, visitLogId, contractorVehicleId, securityId],
    );
    incidentId = rows[0].id;
  }

  const { rows: overrideRows } = await tenantPool.query(
    `SELECT id FROM access_overrides
      WHERE property_id = $1
        AND incident_id = $2
        AND override_type = 'manual_admit'
      LIMIT 1`,
    [propertyId, incidentId],
  );
  let overrideId;
  if (overrideRows[0]) {
    overrideId = overrideRows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO access_overrides
         (property_id, incident_id, pass_id, performed_by_staff_id, override_type, reason)
       VALUES ($1, $2, $3, $4, 'manual_admit', 'E2E canonical manual admit seed')
       RETURNING id`,
      [propertyId, incidentId, passId, securityId],
    );
    overrideId = rows[0].id;
  }

  const { rows: existingOutboxRows } = await tenantPool.query(
    `SELECT id FROM notifications_outbox
      WHERE property_id = $1
        AND event_type = $2
        AND correlation_id = $3
      LIMIT 1`,
    [propertyId, CANONICAL.outboxEventType, accessRequestId],
  );
  let outboxId;
  if (existingOutboxRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE notifications_outbox SET
         channel = 'web_push',
         recipient_type = 'resident',
         recipient_id = $1,
         payload = $2::jsonb,
         status = 'pending',
         attempt_count = 0,
         next_attempt_at = NOW(),
         last_attempted_at = NULL,
         last_error = NULL,
         sent_at = NULL
       WHERE id = $3
       RETURNING id`,
      [
        residentId,
        JSON.stringify({
          title: 'E2E seed ready',
          body: 'Canonical test tenant access sample is ready',
          access_request_id: accessRequestId,
        }),
        existingOutboxRows[0].id,
      ],
    );
    outboxId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO notifications_outbox
         (property_id, event_type, channel, recipient_type, recipient_id,
          payload, status, correlation_id)
       VALUES ($1, $2, 'web_push', 'resident', $3, $4::jsonb, 'pending', $5)
       RETURNING id`,
      [
        propertyId,
        CANONICAL.outboxEventType,
        residentId,
        JSON.stringify({
          title: 'E2E seed ready',
          body: 'Canonical test tenant access sample is ready',
          access_request_id: accessRequestId,
        }),
        accessRequestId,
      ],
    );
    outboxId = rows[0].id;
  }

  const { rows: existingAuditRows } = await tenantPool.query(
    `SELECT id FROM property_audit_log
      WHERE property_id = $1
        AND action = $2
        AND resource_id = $3::text
      LIMIT 1`,
    [propertyId, CANONICAL.auditAction, accessRequestId],
  );
  let auditLogId;
  const auditChanges = JSON.stringify({
    canonical: true,
    visit_log_id: visitLogId,
    incident_id: incidentId,
    override_id: overrideId,
    resident_vehicle_id: residentVehicleId,
  });
  if (existingAuditRows[0]) {
    const { rows } = await tenantPool.query(
      `UPDATE property_audit_log SET
         actor_uid = $1,
         actor_role = 'security',
         actor_type = 'staff',
         resource_type = 'access_request',
         entity_type = 'staff_user',
         entity_id = $2,
         changes = $3::jsonb
       WHERE id = $4
       RETURNING id`,
      [USERS.security.uid, securityId, auditChanges, existingAuditRows[0].id],
    );
    auditLogId = rows[0].id;
  } else {
    const { rows } = await tenantPool.query(
      `INSERT INTO property_audit_log
         (property_id, actor_uid, actor_role, actor_type, action, resource_type,
          resource_id, entity_type, entity_id, changes)
       VALUES ($1, $2, 'security', 'staff', $3, 'access_request', $4::text,
               'staff_user', $5, $6::jsonb)
       RETURNING id`,
      [
        propertyId,
        USERS.security.uid,
        CANONICAL.auditAction,
        accessRequestId,
        securityId,
        auditChanges,
      ],
    );
    auditLogId = rows[0].id;
  }

  return {
    accessRequestId,
    passId,
    visitLogId,
    incidentId,
    overrideId,
    outboxId,
    auditLogId,
  };
}

async function loadCanonicalInvariants(tenantPool, { propertyId, accessRequestId, visitLogId }) {
  const { rows } = await tenantPool.query(
    `SELECT
       (SELECT COUNT(*)::int
          FROM staff_users
         WHERE property_id = $1
           AND external_uid = ANY($2::text[])
           AND is_active = true) AS canonical_staff_users,
       (SELECT COUNT(*)::int
          FROM contractor_companies
         WHERE property_id = $1
           AND name = $3
           AND status = 'active') AS canonical_contractor_companies,
       (SELECT COUNT(*)::int
          FROM contractor_users
         WHERE property_id = $1
           AND external_uid = $4
           AND is_active = true) AS canonical_contractor_users,
       (SELECT COUNT(*)::int
          FROM vehicles
         WHERE property_id = $1
           AND plate_number = ANY($5::text[])) AS canonical_vehicles,
       (SELECT COUNT(*)::int
          FROM access_zones
         WHERE property_id = $1
           AND name = $6
           AND is_active = true) AS canonical_access_zones,
       (SELECT COUNT(*)::int
          FROM access_points
         WHERE property_id = $1
           AND provider = 'domhub-e2e'
           AND provider_external_id = 'canonical-checkpoint'
           AND is_active = true) AS canonical_access_points,
       (SELECT COUNT(*)::int
          FROM access_requests
         WHERE property_id = $1
           AND id = $7) AS canonical_access_requests,
       (SELECT COUNT(*)::int
          FROM passes
         WHERE property_id = $1
           AND access_request_id = $7) AS canonical_passes,
       (SELECT COUNT(*)::int
          FROM visit_logs_v2
         WHERE property_id = $1
           AND id = $8
           AND provider_event_id = $9) AS canonical_visit_logs,
       (SELECT COUNT(*)::int
          FROM access_incidents
         WHERE property_id = $1
           AND related_visit_log_id = $8
           AND incident_type = 'manual_override') AS canonical_access_incidents,
       (SELECT COUNT(*)::int
          FROM notifications_outbox
         WHERE property_id = $1
           AND event_type = $10
           AND correlation_id = $7) AS canonical_notifications_outbox,
       (SELECT COUNT(*)::int
          FROM property_audit_log
         WHERE property_id = $1
           AND action = $11
           AND resource_id = $7::text) AS canonical_property_audit_log`,
    [
      propertyId,
      [USERS.concierge.uid, USERS.security.uid, USERS.admin.uid, USERS.technician.uid],
      CANONICAL.contractorCompany,
      USERS.contractor.uid,
      [CANONICAL.residentPlate, CANONICAL.contractorPlate],
      CANONICAL.zoneName,
      accessRequestId,
      visitLogId,
      CANONICAL.providerEventId,
      CANONICAL.outboxEventType,
      CANONICAL.auditAction,
    ],
  );
  return rows[0];
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
  const adminId = await upsertStaff(
    tenantPool,
    propertyId,
    USERS.admin,
    'property_admin',
    'admin.e2e@domhub.local',
  );
  const technicianId = await upsertStaff(
    tenantPool,
    propertyId,
    USERS.technician,
    'technician',
    'technician.e2e@domhub.local',
  );
  const { contractorCompanyId, contractorUserId } = await upsertContractor(tenantPool, propertyId);

  await upsertRoleMembership(tenantPool, { propertyId, residentId, role: 'resident', createdByStaffId: adminId });
  await upsertRoleMembership(tenantPool, { propertyId, staffUserId: conciergeId, role: 'concierge', createdByStaffId: adminId });
  await upsertRoleMembership(tenantPool, { propertyId, staffUserId: securityId, role: 'security', createdByStaffId: adminId });
  await upsertRoleMembership(tenantPool, { propertyId, staffUserId: adminId, role: 'property_admin', createdByStaffId: adminId });
  await upsertRoleMembership(tenantPool, { propertyId, staffUserId: technicianId, role: 'technician', createdByStaffId: adminId });
  await upsertRoleMembership(tenantPool, { propertyId, contractorUserId, role: 'contractor', createdByStaffId: adminId });

  const { zoneId, pointId } = await upsertAccessTopology(tenantPool, propertyId, buildingId);
  const residentVehicleId = await upsertVehicle(tenantPool, {
    propertyId,
    plate: CANONICAL.residentPlate,
    ownerType: 'resident',
    residentId,
    brand: 'Lada',
    model: 'Vesta',
    notes: 'Canonical seeded resident vehicle',
  });
  const contractorVehicleId = await upsertVehicle(tenantPool, {
    propertyId,
    plate: CANONICAL.contractorPlate,
    ownerType: 'contractor',
    contractorUserId,
    brand: 'GAZ',
    model: 'Sobol',
    vehicleType: 'service_vehicle',
    notes: 'Canonical seeded contractor vehicle',
  });

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

  const canonicalAccess = await seedCanonicalAccessSamples(tenantPool, {
    propertyId,
    residentId,
    securityId,
    contractorUserId,
    residentVehicleId,
    contractorVehicleId,
    zoneId,
    pointId,
  });
  const invariants = await loadCanonicalInvariants(tenantPool, {
    propertyId,
    accessRequestId: canonicalAccess.accessRequestId,
    visitLogId: canonicalAccess.visitLogId,
  });

  return {
    propertyId,
    buildingId,
    entranceId,
    unitId,
    residentId,
    conciergeId,
    securityId,
    adminId,
    technicianId,
    contractorCompanyId,
    contractorUserId,
    zoneId,
    pointId,
    residentVehicleId,
    contractorVehicleId,
    canonicalAccess,
    invariants,
  };
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
    const managementCompanyId = await upsertManagementCompany(platformPool);
    const property = await upsertPlatformProperty(platformPool, tenantDbUrl, managementCompanyId);
    await runMigrations(tenantPool, 'schema_migrations', [...MIGRATIONS, ...V1_PROPERTY_MIGRATIONS]);
    await upsertLegacyUsers(globalPool);
    await upsertLegacyUsers(tenantPool);
    const seeded = await seedTenant(tenantPool, property.id);

    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      ok: true,
      property_slug: PROPERTY_SLUG,
      property_type: property.property_type,
      management_company_id: managementCompanyId,
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
