'use strict';

const crypto = require('crypto');
const {
  resolveResidentIdByUid,
  resolveStaffIdByUid,
} = require('./accessActorResolver');

const PASS_COLS = `
  id, property_id, access_request_id, pass_type, subject_type,
  subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
  zone_id, point_id, policy_id,
  valid_from, valid_until, status,
  approved_by_staff_id, revoked_at, revoked_by_staff_id, revoked_reason, created_at
`;

const TERMINAL_STATUSES = new Set(['expired', 'revoked']);

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
  return err instanceof PassServiceError;
}

function newToken() {
  return crypto.randomBytes(16).toString('hex');
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

async function requireReadablePass({ queryable, user, isStaffUser, passId, selectCols }) {
  const { rows } = await queryable.query(
    `SELECT ${selectCols} FROM passes WHERE id = $1`,
    [passId],
  );
  if (!rows[0]) throw serviceError(404, 'Pass not found');
  const pass = rows[0];
  if (!(await canReadPass({ queryable, user, isStaffUser, pass }))) {
    throw serviceError(403, 'Forbidden');
  }
  return pass;
}

async function getOrCreateQr({ queryable, user, isStaffUser, passId }) {
  const pass = await requireReadablePass({
    queryable,
    user,
    isStaffUser,
    passId,
    selectCols: 'id, property_id, access_request_id, subject_resident_id, status',
  });
  if (TERMINAL_STATUSES.has(pass.status)) {
    throw serviceError(409, `Cannot fetch QR for pass in status '${pass.status}'`);
  }

  const { rows: existing } = await queryable.query(
    `SELECT id, token, render_version FROM qr_passes_v2 WHERE pass_id = $1`,
    [pass.id],
  );
  if (existing[0]) return { pass, qr: existing[0] };

  const { rows: created } = await queryable.query(
    `INSERT INTO qr_passes_v2 (property_id, pass_id, token)
     VALUES ($1, $2, $3)
     RETURNING id, token, render_version`,
    [pass.property_id, pass.id, newToken()],
  );
  return { pass, qr: created[0] };
}

async function regenerateQr({ queryable, user, isStaffUser, passId }) {
  const pass = await requireReadablePass({
    queryable,
    user,
    isStaffUser,
    passId,
    selectCols: 'id, property_id, access_request_id, subject_resident_id, status',
  });
  if (TERMINAL_STATUSES.has(pass.status)) {
    throw serviceError(409, `Cannot regenerate QR for pass in status '${pass.status}'`);
  }

  const { rows } = await queryable.query(
    `INSERT INTO qr_passes_v2 (property_id, pass_id, token)
     VALUES ($1, $2, $3)
     ON CONFLICT (pass_id)
     DO UPDATE SET token = EXCLUDED.token,
                   render_version = qr_passes_v2.render_version + 1,
                   updated_at = NOW()
     RETURNING id, token, render_version`,
    [pass.property_id, pass.id, newToken()],
  );
  return { pass, qr: rows[0] };
}

async function createPass({ queryable, user, input }) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');

  const { rows } = await queryable.query(
    `INSERT INTO passes
       (property_id, access_request_id, pass_type, subject_type,
        subject_resident_id, subject_staff_id, subject_contractor_user_id, subject_vehicle_id,
        valid_from, valid_until, approved_by_staff_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING ${PASS_COLS}`,
    [
      input.property_id, input.access_request_id, input.pass_type, input.subject_type,
      input.subject_resident_id, input.subject_staff_id,
      input.subject_contractor_user_id, input.subject_vehicle_id,
      input.valid_from, input.valid_until, staffId,
    ],
  );
  return { pass: rows[0] };
}

async function revokePass({ queryable, user, passId, reason }) {
  const staffId = await resolveStaffIdByUid(queryable, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');

  const { rows: curRows } = await queryable.query(
    `SELECT status FROM passes WHERE id = $1`,
    [passId],
  );
  if (!curRows[0]) throw serviceError(404, 'Pass not found');
  if (curRows[0].status === 'revoked') throw serviceError(409, 'Pass already revoked');

  const { rows } = await queryable.query(
    `UPDATE passes SET
       status = 'revoked',
       revoked_at = NOW(),
       revoked_by_staff_id = $1,
       revoked_reason = $2
    WHERE id = $3
     RETURNING ${PASS_COLS}`,
    [staffId, reason, passId],
  );
  return { pass: rows[0] };
}

async function blockPass({ queryable, passId }) {
  const { rows: curRows } = await queryable.query(
    `SELECT status FROM passes WHERE id = $1`,
    [passId],
  );
  if (!curRows[0]) throw serviceError(404, 'Pass not found');
  if (curRows[0].status === 'revoked' || curRows[0].status === 'expired') {
    throw serviceError(409, `Cannot block pass in status '${curRows[0].status}'`);
  }
  const { rows } = await queryable.query(
    `UPDATE passes SET status = 'blocked' WHERE id = $1 RETURNING ${PASS_COLS}`,
    [passId],
  );
  return { pass: rows[0] };
}

async function unblockPass({ queryable, passId }) {
  const { rows: curRows } = await queryable.query(
    `SELECT status FROM passes WHERE id = $1`,
    [passId],
  );
  if (!curRows[0]) throw serviceError(404, 'Pass not found');
  if (curRows[0].status !== 'blocked') {
    throw serviceError(409, `Pass is not blocked (status='${curRows[0].status}')`);
  }
  const { rows } = await queryable.query(
    `UPDATE passes SET status = 'active' WHERE id = $1 RETURNING ${PASS_COLS}`,
    [passId],
  );
  return { pass: rows[0] };
}

module.exports = {
  PASS_COLS,
  PassServiceError,
  blockPass,
  canReadPass,
  createPass,
  getOrCreateQr,
  isPassServiceError,
  regenerateQr,
  revokePass,
  unblockPass,
};
