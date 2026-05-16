'use strict';

const crypto = require('crypto');
const { resolveStaffIdByUid } = require('./accessActorResolver');

const DEVICE_COLS = `
  id, property_id, access_point_id, staff_user_id, device_fingerprint, label,
  status, last_seen_at, approved_by_staff_id, approved_at, revoked_at,
  created_at, updated_at
`;

class GuardAuthorizedDeviceServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GuardAuthorizedDeviceServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new GuardAuthorizedDeviceServiceError(status, message);
}

function isGuardAuthorizedDeviceServiceError(err) {
  return err instanceof GuardAuthorizedDeviceServiceError;
}

function normalizeText(value, field, maxLength = 120) {
  if (typeof value !== 'string' || !value.trim()) {
    throw serviceError(400, `${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) throw serviceError(400, `${field} is too long`);
  return trimmed;
}

function normalizeNullableUuid(value, field) {
  if (value === undefined || value === null || value === '') return null;
  return normalizeText(value, field, 80);
}

function normalizeDeviceFingerprint(value) {
  const trimmed = normalizeText(value, 'device_fingerprint', 256);
  if (trimmed.length < 16) throw serviceError(400, 'device_fingerprint is too short');
  return trimmed;
}

function hashDeviceFingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(`guard-device:v1:${value}`)
    .digest('hex');
}

function normalizeLabel(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return normalizeText(value, 'label', 120);
}

async function ensureStaffId(queryable, user) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  return staffId;
}

async function ensureAccessPoint(queryable, { propertyId, accessPointId }) {
  if (!accessPointId) return;
  const { rows } = await queryable.query(
    `SELECT id
       FROM access_points
      WHERE id = $1 AND property_id = $2 AND is_active = true
      LIMIT 1`,
    [accessPointId, propertyId],
  );
  if (!rows[0]) throw serviceError(400, 'access_point_id does not exist for this property');
}

function deviceContext(row) {
  if (!row) return null;
  return {
    guard_device_id: row.id,
    device_label: row.label,
    access_point_id: row.access_point_id || null,
    staff_user_id: row.staff_user_id || null,
    status: row.status,
  };
}

function publicDevice(row) {
  if (!row) return null;
  const { device_fingerprint: fingerprintHash, ...rest } = row;
  return {
    ...rest,
    device_fingerprint_preview: typeof fingerprintHash === 'string'
      ? fingerprintHash.slice(-8)
      : null,
  };
}

async function writeAudit(queryable, {
  propertyId,
  actorUid,
  actorRole,
  deviceId,
  action,
  changes,
  ipAddress = null,
}) {
  await queryable.query(
    `INSERT INTO property_audit_log
       (property_id, actor_uid, actor_role, actor_type, entity_type, entity_id,
        action, resource_type, resource_id, changes, ip_address)
     VALUES ($1,$2,$3,'staff','guard_authorized_device',$4,$5,
             'guard_authorized_device',$4,$6,$7)`,
    [
      propertyId,
      actorUid || null,
      actorRole || null,
      deviceId,
      action,
      JSON.stringify(changes || {}),
      ipAddress,
    ],
  );
}

async function enrollGuardAuthorizedDevice(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const accessPointId = normalizeNullableUuid(input.accessPointId || input.access_point_id, 'access_point_id');
  const deviceFingerprint = normalizeDeviceFingerprint(input.deviceFingerprint || input.device_fingerprint);
  const deviceFingerprintHash = hashDeviceFingerprint(deviceFingerprint);
  const staffId = await ensureStaffId(queryable, input.user);
  await ensureAccessPoint(queryable, { propertyId, accessPointId });
  const activate = input.activate === true || input.status === 'active';
  const nextStatus = activate ? 'active' : 'pending';

  const label = normalizeLabel(
    input.label,
    accessPointId ? `Guard checkpoint ${accessPointId.slice(0, 8)}` : 'Guard device',
  );

  const { rows } = await queryable.query(
      `INSERT INTO guard_authorized_devices
        (property_id, access_point_id, staff_user_id, device_fingerprint,
         label, status, last_seen_at, approved_by_staff_id, approved_at)
     VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,CASE WHEN $6 = 'active' THEN NOW() ELSE NULL END)
     ON CONFLICT (property_id, device_fingerprint)
     DO UPDATE SET
        access_point_id = EXCLUDED.access_point_id,
        staff_user_id = EXCLUDED.staff_user_id,
        label = EXCLUDED.label,
        status = CASE
          WHEN guard_authorized_devices.status = 'active' THEN 'active'
          ELSE EXCLUDED.status
        END,
        last_seen_at = NOW(),
        approved_by_staff_id = CASE
          WHEN EXCLUDED.status = 'active' THEN EXCLUDED.approved_by_staff_id
          ELSE guard_authorized_devices.approved_by_staff_id
        END,
        approved_at = CASE
          WHEN EXCLUDED.status = 'active' THEN NOW()
          ELSE guard_authorized_devices.approved_at
        END,
        updated_at = NOW()
      WHERE guard_authorized_devices.status <> 'revoked'
      RETURNING ${DEVICE_COLS}`,
    [propertyId, accessPointId, staffId, deviceFingerprintHash, label, nextStatus, activate ? staffId : null],
  );
  const device = rows[0];
  if (!device) {
    throw serviceError(409, 'Guard device was revoked and cannot be re-enrolled');
  }

  await writeAudit(queryable, {
    propertyId,
    actorUid: input.user?.uid || null,
    actorRole: input.user?.role || null,
    deviceId: device.id,
    action: device.status === 'active'
      ? 'guard_authorized_device.enrolled'
      : 'guard_authorized_device.enrollment_requested',
    changes: deviceContext(device),
    ipAddress: input.ipAddress || input.ip_address || null,
  });

  return publicDevice(device);
}

async function listGuardAuthorizedDevices(queryable, {
  propertyId,
  accessPointId = null,
  status = null,
  limit = 100,
} = {}) {
  const filters = ['property_id = $1'];
  const params = [normalizeText(propertyId, 'property_id', 80)];
  if (accessPointId) {
    params.push(accessPointId);
    filters.push(`access_point_id = $${params.length}`);
  }
  if (status) {
    const normalized = normalizeText(status, 'status', 20);
    if (!['pending', 'active', 'revoked'].includes(normalized)) throw serviceError(400, 'Invalid status');
    params.push(normalized);
    filters.push(`status = $${params.length}`);
  }
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  params.push(safeLimit);

  const { rows } = await queryable.query(
    `SELECT ${DEVICE_COLS}
       FROM guard_authorized_devices
      WHERE ${filters.join(' AND ')}
      ORDER BY status ASC, last_seen_at DESC NULLS LAST, updated_at DESC
      LIMIT $${params.length}`,
    params,
  );
  return rows.map(publicDevice);
}

async function approveGuardAuthorizedDevice(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const deviceId = normalizeText(input.guardDeviceId || input.guard_device_id || input.deviceId || input.id, 'guard_device_id', 80);
  const approverStaffId = await ensureStaffId(queryable, input.user);
  const { rows } = await queryable.query(
    `UPDATE guard_authorized_devices
        SET status = 'active',
            approved_by_staff_id = $3,
            approved_at = COALESCE(approved_at, NOW()),
            last_seen_at = NOW(),
            updated_at = NOW()
      WHERE id = $1 AND property_id = $2 AND status = 'pending'
      RETURNING ${DEVICE_COLS}`,
    [deviceId, propertyId, approverStaffId],
  );
  const device = rows[0];
  if (!device) throw serviceError(404, 'Pending guard authorized device not found');

  await writeAudit(queryable, {
    propertyId,
    actorUid: input.user?.uid || null,
    actorRole: input.user?.role || null,
    deviceId: device.id,
    action: 'guard_authorized_device.approved',
    changes: deviceContext(device),
    ipAddress: input.ipAddress || input.ip_address || null,
  });

  return publicDevice(device);
}

async function revokeGuardAuthorizedDevice(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const deviceId = normalizeText(input.guardDeviceId || input.guard_device_id || input.deviceId || input.id, 'guard_device_id', 80);
  const { rows } = await queryable.query(
    `UPDATE guard_authorized_devices
        SET status = 'revoked',
            revoked_at = COALESCE(revoked_at, NOW()),
            updated_at = NOW()
      WHERE id = $1 AND property_id = $2
      RETURNING ${DEVICE_COLS}`,
    [deviceId, propertyId],
  );
  const device = rows[0];
  if (!device) throw serviceError(404, 'Guard authorized device not found');

  await writeAudit(queryable, {
    propertyId,
    actorUid: input.actorUid || input.actor_uid || input.user?.uid || null,
    actorRole: input.actorRole || input.actor_role || input.user?.role || null,
    deviceId: device.id,
    action: 'guard_authorized_device.revoked',
    changes: {
      ...deviceContext(device),
      reason: input.reason || null,
    },
    ipAddress: input.ipAddress || input.ip_address || null,
  });

  return publicDevice(device);
}

async function assertGuardDeviceAuthorized(queryable, input) {
  const propertyId = normalizeText(input.propertyId || input.property_id, 'property_id', 80);
  const accessPointId = normalizeNullableUuid(input.accessPointId || input.access_point_id, 'access_point_id');
  const deviceId = normalizeText(input.guardDeviceId || input.guard_device_id, 'guard_device_id', 80);
  const deviceFingerprint = normalizeDeviceFingerprint(input.deviceFingerprint || input.device_fingerprint);
  const deviceFingerprintHash = hashDeviceFingerprint(deviceFingerprint);
  const staffId = await ensureStaffId(queryable, input.user);

  const { rows } = await queryable.query(
    `SELECT ${DEVICE_COLS}
         FROM guard_authorized_devices
       WHERE id = $1
         AND property_id = $2
         AND device_fingerprint = $3
       LIMIT 1`,
    [deviceId, propertyId, deviceFingerprintHash],
  );
  const device = rows[0];
  if (!device) throw serviceError(403, 'Guard device is not authorized');
  if (device.status === 'revoked') throw serviceError(403, 'Guard device is revoked');
  if (device.status !== 'active') throw serviceError(403, 'Guard device is pending approval');
  if (device.staff_user_id && device.staff_user_id !== staffId) {
    throw serviceError(403, 'Guard device is not authorized for this staff user');
  }
  if (device.access_point_id && device.access_point_id !== accessPointId) {
    throw serviceError(403, 'Guard device is not authorized for this access point');
  }

  const { rows: touched } = await queryable.query(
    `UPDATE guard_authorized_devices
        SET last_seen_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND property_id = $2
      RETURNING ${DEVICE_COLS}`,
    [device.id, propertyId],
  );
  return touched[0] || device;
}

module.exports = {
  GuardAuthorizedDeviceServiceError,
  approveGuardAuthorizedDevice,
  assertGuardDeviceAuthorized,
  deviceContext,
  enrollGuardAuthorizedDevice,
  isGuardAuthorizedDeviceServiceError,
  listGuardAuthorizedDevices,
  revokeGuardAuthorizedDevice,
};
