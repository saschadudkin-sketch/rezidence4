'use strict';

const crypto = require('crypto');
const {
  resolveResidentIdByUid,
  resolveStaffIdByUid,
} = require('./accessActorResolver');
const {
  StateTransitionError,
  assertPassAction,
} = require('./accessStateMachine');
const {
  decryptCredentialSecret,
  encryptCredentialSecret,
  generatePin,
  hashPin,
} = require('./passCredentialService');
const { evaluateAccessPolicy } = require('./accessPolicyService');

const PASS_COLS = `
  id, property_id, access_request_id, pass_type, subject_type,
  subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
  zone_id, point_id, policy_id,
  valid_from, valid_until, status,
  approved_by_staff_id, revoked_at, revoked_by_staff_id, revoked_reason, created_at
`;

class PassServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PassServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new PassServiceError(status, message);
}

function isPassServiceError(err) {
  return err instanceof PassServiceError || err instanceof StateTransitionError;
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
}

function passSubjectForPolicy(pass) {
  if (pass.pass_type === 'vehicle' || pass.subject_type === 'vehicle') return 'vehicle';
  if (pass.pass_type === 'contractor' || pass.pass_type === 'service') return 'contractor';
  if (pass.pass_type === 'courier') return 'courier';
  if (pass.pass_type === 'resident' || pass.subject_type === 'resident') return 'resident';
  if (pass.pass_type === 'staff' || pass.pass_type === 'emergency') return 'staff';
  return 'guest';
}

async function findPinPolicy(queryable, pass) {
  const subjectType = passSubjectForPolicy(pass);
  const decision = await evaluateAccessPolicy({
    queryable,
    propertyId: pass.property_id,
    subjectType,
    passType: pass.pass_type,
    accessMethod: 'pin',
    pointId: pass.point_id || null,
    pass,
    now: new Date(),
  });
  if (!decision.allowed || !decision.matched_policy_id) return null;

  const { rows } = await queryable.query(
    `SELECT id, metadata
       FROM access_policies
      WHERE id = $1
        AND property_id = $2
        AND is_active = true
        AND access_method = 'pin'
        AND effect = 'allow'
      LIMIT 1`,
    [decision.matched_policy_id, pass.property_id],
  );
  return rows[0] || null;
}

function pinPolicyAllowsPublicDisplay(policy) {
  const metadata = parseMetadata(policy?.metadata);
  return metadata.public_pin_display === true || metadata.show_pin_on_public_pass === true;
}

async function getCurrentQrCredential(queryable, passId, propertyId = null) {
  const params = [passId];
  const propertyPredicate = propertyId ? ' AND property_id = $2' : '';
  if (propertyId) params.push(propertyId);
  const { rows } = await queryable.query(
    `SELECT id, token, render_version
       FROM pass_credentials
      WHERE pass_id = $1
        ${propertyPredicate}
        AND credential_type = 'qr'
        AND revoked_at IS NULL`,
    params,
  );
  if (rows[0]) return rows[0];

  const { rows: legacyRows } = await queryable.query(
    `SELECT id, token, render_version
       FROM qr_passes_v2
      WHERE pass_id = $1${propertyPredicate}`,
    params,
  );
  return legacyRows[0] || null;
}

async function assertPropertyReference(queryable, { table, id, propertyId, field, active = false }) {
  if (!id) return null;
  const { rows } = await queryable.query(
    `SELECT id
       FROM ${table}
      WHERE id = $1
        AND property_id = $2
        ${active ? 'AND is_active = true' : ''}
      LIMIT 1`,
    [id, propertyId],
  );
  if (!rows[0]) {
    throw serviceError(400, `${field} does not exist for this property`);
  }
  return rows[0];
}

async function validatePassReferences(queryable, input) {
  const propertyId = input.property_id;
  if (!propertyId) throw serviceError(400, 'property_id is required');

  await assertPropertyReference(queryable, {
    table: 'access_requests',
    id: input.access_request_id,
    propertyId,
    field: 'access_request_id',
  });

  const subjectChecks = {
    resident: ['residents', input.subject_resident_id, 'subject_resident_id'],
    staff: ['staff_users', input.subject_staff_id, 'subject_staff_id'],
    contractor: ['contractor_users', input.subject_contractor_user_id, 'subject_contractor_user_id'],
    vehicle: ['vehicles', input.subject_vehicle_id, 'subject_vehicle_id'],
  };
  const subjectCheck = subjectChecks[input.subject_type];
  if (subjectCheck) {
    await assertPropertyReference(queryable, {
      table: subjectCheck[0],
      id: subjectCheck[1],
      propertyId,
      field: subjectCheck[2],
    });
  }

  await assertPropertyReference(queryable, {
    table: 'access_zones',
    id: input.zone_id,
    propertyId,
    field: 'zone_id',
    active: true,
  });

  if (input.point_id) {
    const { rows } = await queryable.query(
      `SELECT id, zone_id
         FROM access_points
        WHERE id = $1
          AND property_id = $2
          AND is_active = true
        LIMIT 1`,
      [input.point_id, propertyId],
    );
    if (!rows[0]) throw serviceError(400, 'point_id does not exist for this property');
    if (input.zone_id && rows[0].zone_id && rows[0].zone_id !== input.zone_id) {
      throw serviceError(400, 'point_id does not belong to zone_id');
    }
  }
}

async function createQrCredential(queryable, pass) {
  const token = newToken();
  const { rows } = await queryable.query(
    `INSERT INTO pass_credentials (property_id, pass_id, credential_type, token)
     VALUES ($1, $2, 'qr', $3)
     ON CONFLICT (pass_id, credential_type) WHERE revoked_at IS NULL
     DO UPDATE SET token = EXCLUDED.token,
                   render_version = pass_credentials.render_version + 1,
                   revoked_at = NULL,
                   updated_at = NOW()
     RETURNING id, token, render_version`,
    [pass.property_id, pass.id, token],
  );
  await upsertQrCompatibility(queryable, pass, rows[0]);
  return rows[0];
}

async function upsertQrCompatibility(queryable, pass, qr) {
  await queryable.query(
    `INSERT INTO qr_passes_v2 (property_id, pass_id, token, render_version)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (pass_id)
     DO UPDATE SET token = EXCLUDED.token,
                   render_version = EXCLUDED.render_version,
                   updated_at = NOW()`,
    [pass.property_id, pass.id, qr.token, qr.render_version],
  );
}

async function invalidatePassCredentials(queryable, passId, propertyId = null) {
  const params = [passId];
  const propertyPredicate = propertyId ? ' AND property_id = $2' : '';
  if (propertyId) params.push(propertyId);
  await queryable.query(
    `UPDATE pass_credentials
        SET revoked_at = COALESCE(revoked_at, NOW()),
            updated_at = NOW()
      WHERE pass_id = $1
        ${propertyPredicate}
        AND revoked_at IS NULL`,
    params,
  );
  await queryable.query(
    `DELETE FROM qr_passes_v2 WHERE pass_id = $1${propertyPredicate}`,
    params,
  );
}

async function canReadPass({ queryable, user, isStaffUser, pass }) {
  if (isStaffUser) return true;
  const residentId = await resolveResidentIdByUid(queryable, user?.uid);
  if (!residentId) return false;
  if (pass.subject_resident_id === residentId) return true;
  if (!pass.access_request_id) return false;

  const { rows } = await queryable.query(
    `SELECT 1
       FROM access_requests
      WHERE id = $1
        AND created_by_resident_id = $2
      LIMIT 1`,
    [pass.access_request_id, residentId],
  );
  return rows.length > 0;
}

async function requireReadablePass({ queryable, user, isStaffUser, passId, selectCols, propertyId = null }) {
  const params = [passId];
  const propertyPredicate = propertyId ? ' AND property_id = $2' : '';
  if (propertyId) params.push(propertyId);
  const { rows } = await queryable.query(
    `SELECT ${selectCols} FROM passes WHERE id = $1${propertyPredicate}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Pass not found');
  const pass = rows[0];
  if (!(await canReadPass({ queryable, user, isStaffUser, pass }))) {
    throw serviceError(403, 'Forbidden');
  }
  return pass;
}

async function getOrCreateQr({ queryable, user, isStaffUser, passId, propertyId = null }) {
  const pass = await requireReadablePass({
    queryable,
    user,
    isStaffUser,
    passId,
    propertyId,
    selectCols: 'id, property_id, access_request_id, subject_resident_id, status',
  });
  assertPassAction(pass.status, 'qr');

  const existing = await getCurrentQrCredential(queryable, pass.id, pass.property_id);
  if (existing) {
    await upsertQrCompatibility(queryable, pass, existing);
    return { pass, qr: existing };
  }

  const qr = await createQrCredential(queryable, pass);
  return { pass, qr };
}

async function regenerateQr({ queryable, user, isStaffUser, passId, propertyId = null }) {
  const pass = await requireReadablePass({
    queryable,
    user,
    isStaffUser,
    passId,
    propertyId,
    selectCols: 'id, property_id, access_request_id, subject_resident_id, status',
  });
  assertPassAction(pass.status, 'regenerate_qr');

  const { rows } = await queryable.query(
    `INSERT INTO pass_credentials (property_id, pass_id, credential_type, token)
     VALUES ($1, $2, 'qr', $3)
     ON CONFLICT (pass_id, credential_type) WHERE revoked_at IS NULL
     DO UPDATE SET token = EXCLUDED.token,
                   render_version = pass_credentials.render_version + 1,
                   updated_at = NOW()
     RETURNING id, token, render_version`,
    [pass.property_id, pass.id, newToken()],
  );
  await upsertQrCompatibility(queryable, pass, rows[0]);
  return { pass, qr: rows[0] };
}

async function regeneratePin({ queryable, user, isStaffUser, passId, propertyId = null }) {
  const pass = await requireReadablePass({
    queryable,
    user,
    isStaffUser,
    passId,
    propertyId,
    selectCols: 'id, property_id, access_request_id, subject_resident_id, status, pass_type, subject_type, zone_id, point_id, policy_id',
  });
  assertPassAction(pass.status, 'regenerate_pin');

  const policy = await findPinPolicy(queryable, pass);
  if (!policy) throw serviceError(422, 'PIN credentials are not allowed by policy');

  const pin = generatePin();
  const pinHash = hashPin(pin);
  const encrypted = encryptCredentialSecret(pin);
  const { rows } = await queryable.query(
    `INSERT INTO pass_credentials
       (property_id, pass_id, credential_type, credential_hash,
        credential_ciphertext, credential_iv, credential_tag)
     VALUES ($1, $2, 'pin', $3, $4, $5, $6)
     ON CONFLICT (pass_id, credential_type) WHERE revoked_at IS NULL
     DO UPDATE SET credential_hash = EXCLUDED.credential_hash,
                   credential_ciphertext = EXCLUDED.credential_ciphertext,
                   credential_iv = EXCLUDED.credential_iv,
                   credential_tag = EXCLUDED.credential_tag,
                   used_at = NULL,
                   render_version = pass_credentials.render_version + 1,
                   updated_at = NOW()
     RETURNING id, render_version, expires_at, created_at, updated_at,
               credential_ciphertext, credential_iv, credential_tag`,
    [
      pass.property_id,
      pass.id,
      pinHash,
      encrypted.credential_ciphertext,
      encrypted.credential_iv,
      encrypted.credential_tag,
    ],
  );

  return {
    pass,
    pin: {
      id: rows[0].id,
      render_version: rows[0].render_version,
      expires_at: rows[0].expires_at,
      created_at: rows[0].created_at,
      updated_at: rows[0].updated_at,
      value: pin,
      public_display_allowed: pinPolicyAllowsPublicDisplay(policy),
    },
  };
}

async function getCurrentPin({ queryable, user, isStaffUser, passId, propertyId = null }) {
  const pass = await requireReadablePass({
    queryable,
    user,
    isStaffUser,
    passId,
    propertyId,
    selectCols: 'id, property_id, access_request_id, subject_resident_id, status, pass_type, subject_type, zone_id, point_id, policy_id',
  });
  assertPassAction(pass.status, 'pin');

  const policy = await findPinPolicy(queryable, pass);
  if (!policy) throw serviceError(422, 'PIN credentials are not allowed by policy');

  const { rows } = await queryable.query(
    `SELECT id, render_version, expires_at, created_at, updated_at,
            credential_ciphertext, credential_iv, credential_tag
       FROM pass_credentials
      WHERE pass_id = $1
        AND property_id = $2
        AND credential_type = 'pin'
        AND revoked_at IS NULL
        AND used_at IS NULL
        AND (expires_at IS NULL OR expires_at >= NOW())
      LIMIT 1`,
    [pass.id, pass.property_id],
  );
  if (!rows[0]) throw serviceError(404, 'PIN credential not found');
  const value = decryptCredentialSecret(rows[0]);
  if (!value) throw serviceError(409, 'PIN credential cannot be displayed');
  return {
    pass,
    pin: {
      id: rows[0].id,
      render_version: rows[0].render_version,
      expires_at: rows[0].expires_at,
      created_at: rows[0].created_at,
      updated_at: rows[0].updated_at,
      value,
      public_display_allowed: pinPolicyAllowsPublicDisplay(policy),
    },
  };
}

async function createPass({ queryable, user, input }) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  await validatePassReferences(queryable, input);

  const { rows } = await queryable.query(
    `INSERT INTO passes
       (property_id, access_request_id, pass_type, subject_type,
        subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
        zone_id, point_id, valid_from, valid_until, approved_by_staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING ${PASS_COLS}`,
    [
      input.property_id, input.access_request_id, input.pass_type, input.subject_type,
      input.subject_resident_id, input.subject_staff_id,
      input.subject_contractor_user_id, input.subject_vehicle_id,
      input.zone_id || null, input.point_id || null,
      input.valid_from, input.valid_until, staffId,
    ],
  );
  return { pass: rows[0] };
}

async function revokePass({ queryable, user, passId, reason, propertyId = null }) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');

  const { rows: curRows } = await queryable.query(
    `SELECT status FROM passes WHERE id = $1${propertyId ? ' AND property_id = $2' : ''}`,
    propertyId ? [passId, propertyId] : [passId],
  );
  if (!curRows[0]) throw serviceError(404, 'Pass not found');
  assertPassAction(curRows[0].status, 'revoke');

  const { rows } = await queryable.query(
    `UPDATE passes SET
       status = 'revoked',
       revoked_at = NOW(),
       revoked_by_staff_id = $1,
       revoked_reason = $2
    WHERE id = $3
      ${propertyId ? 'AND property_id = $4' : ''}
     RETURNING ${PASS_COLS}`,
    propertyId ? [staffId, reason, passId, propertyId] : [staffId, reason, passId],
  );
  await invalidatePassCredentials(queryable, passId, rows[0].property_id);
  await queryable.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type, payload, correlation_id)
     VALUES ($1, 'access.pass.revoked', 'webhook', 'external', $2, $3)`,
    [
      rows[0].property_id,
      JSON.stringify({ pass_id: passId, reason }),
      passId,
    ],
  );
  return { pass: rows[0] };
}

async function blockPass({ queryable, passId, reason = null, propertyId = null }) {
  const { rows: curRows } = await queryable.query(
    `SELECT status FROM passes WHERE id = $1${propertyId ? ' AND property_id = $2' : ''}`,
    propertyId ? [passId, propertyId] : [passId],
  );
  if (!curRows[0]) throw serviceError(404, 'Pass not found');
  assertPassAction(curRows[0].status, 'block');
  const { rows } = await queryable.query(
    `UPDATE passes
        SET status = 'blocked'
      WHERE id = $1${propertyId ? ' AND property_id = $2' : ''}
      RETURNING ${PASS_COLS}`,
    propertyId ? [passId, propertyId] : [passId],
  );
  await invalidatePassCredentials(queryable, passId, rows[0].property_id);
  await queryable.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type, payload, correlation_id)
     VALUES ($1, 'access.pass.blocked', 'webhook', 'external', $2, $3)`,
    [
      rows[0].property_id,
      JSON.stringify({ pass_id: passId, reason }),
      passId,
    ],
  );
  return { pass: rows[0] };
}

async function policyAllowsUnblock(queryable, pass) {
  if (!pass.policy_id) return false;
  const { rows } = await queryable.query(
    `SELECT metadata FROM access_policies WHERE id = $1 AND property_id = $2`,
    [pass.policy_id, pass.property_id],
  );
  if (!rows[0]) return false;
  const metadata = rows[0].metadata && typeof rows[0].metadata === 'object'
    ? rows[0].metadata
    : typeof rows[0].metadata === 'string'
      ? JSON.parse(rows[0].metadata)
      : {};
  return metadata.allow_pass_unblock === true || metadata.allow_reactivation === true;
}

async function unblockPass({ queryable, passId, reason, policyId = null, overrideId = null, propertyId = null }) {
  const { rows: curRows } = await queryable.query(
    `SELECT id, property_id, status, policy_id
       FROM passes
      WHERE id = $1${propertyId ? ' AND property_id = $2' : ''}`,
    propertyId ? [passId, propertyId] : [passId],
  );
  if (!curRows[0]) throw serviceError(404, 'Pass not found');
  const pass = curRows[0];
  assertPassAction(pass.status, 'unblock');
  if (!reason || !String(reason).trim()) throw serviceError(400, 'reason is required');
  if (!policyId && !overrideId) {
    throw serviceError(422, 'policy_id or override_id is required for unblock');
  }
  if (policyId && policyId !== pass.policy_id) {
    throw serviceError(409, 'policy_id does not match pass policy');
  }
  if (!overrideId && !(await policyAllowsUnblock(queryable, pass))) {
    throw serviceError(422, 'Pass policy does not allow reactivation');
  }
  const { rows } = await queryable.query(
    `UPDATE passes
        SET status = 'active'
      WHERE id = $1 AND property_id = $2
      RETURNING ${PASS_COLS}`,
    [passId, pass.property_id],
  );
  await queryable.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type, payload, correlation_id)
     VALUES ($1, 'access.pass.unblocked', 'webhook', 'external', $2, $3)`,
    [
      rows[0].property_id,
      JSON.stringify({ pass_id: passId, reason, policy_id: policyId, override_id: overrideId }),
      passId,
    ],
  );
  return { pass: rows[0] };
}

module.exports = {
  PASS_COLS,
  PassServiceError,
  blockPass,
  canReadPass,
  createPass,
  getCurrentPin,
  getOrCreateQr,
  isPassServiceError,
  regenerateQr,
  regeneratePin,
  revokePass,
  unblockPass,
};
