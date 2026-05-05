'use strict';

const { resolveFlags } = require('../../config/featureFlags');
const { isStaff } = require('../lib/authz');
const {
  resolveResidentIdByUid,
  resolveStaffIdByUid,
  resolveContractorUserIdByUid,
} = require('./accessActorResolver');
const {
  StateTransitionError,
  assertAccessRequestAction,
} = require('./accessStateMachine');

const AR_COLS = `
  id, property_id, created_by_type,
  created_by_resident_id, created_by_staff_id, created_by_contractor_user_id,
  request_type, visitor_name, visitor_phone, vehicle_id,
  target_zone_id, target_point_id, target_unit_id,
  reason, starts_at, ends_at, status, approval_required,
  approved_at, rejected_at, cancelled_at, created_at, updated_at
`;

const REQUEST_TO_PASS_TYPE = Object.freeze({
  guest_access: 'guest',
  vehicle_access: 'vehicle',
  contractor_access: 'contractor',
  courier_access: 'courier',
  service_access: 'service',
  temporary_resident_access: 'guest',
});

const AUTO_ISSUE_REQUEST_TYPES = new Set(['guest_access', 'courier_access', 'contractor_access']);
const AUTO_ISSUE_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

class AccessRequestServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AccessRequestServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new AccessRequestServiceError(status, message);
}

function isAccessRequestServiceError(err) {
  return err instanceof AccessRequestServiceError || err instanceof StateTransitionError;
}

function getResolvedFeatureFlags(property) {
  return property?.resolvedFlags || resolveFlags(property?.feature_flags);
}

function shouldRequireManualApproval({ property, requestType, startsAt, endsAt }) {
  const flags = getResolvedFeatureFlags(property);
  if (flags.manual_access_approval) return true;
  if (!AUTO_ISSUE_REQUEST_TYPES.has(requestType)) return true;

  const windowMs = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return windowMs > AUTO_ISSUE_MAX_WINDOW_MS;
}

function isContractorRole(role) {
  return role === 'contractor';
}

function getPassSubject({ requestType, vehicleId, contractorUserId }) {
  if (vehicleId) {
    return {
      subjectType: 'vehicle',
      subjectVehicleId: vehicleId,
      subjectContractorUserId: null,
    };
  }
  if (requestType === 'contractor_access' && contractorUserId) {
    return {
      subjectType: 'contractor_user',
      subjectVehicleId: null,
      subjectContractorUserId: contractorUserId,
    };
  }
  return {
    subjectType: 'guest',
    subjectVehicleId: null,
    subjectContractorUserId: null,
  };
}

async function insertPassForAccessRequest(client, ar, approvedByStaffId = null) {
  const passType = REQUEST_TO_PASS_TYPE[ar.request_type];
  const { subjectType, subjectVehicleId, subjectContractorUserId } = getPassSubject({
    requestType: ar.request_type,
    vehicleId: ar.vehicle_id,
    contractorUserId: ar.created_by_contractor_user_id,
  });

  const { rows } = await client.query(
    `INSERT INTO passes
       (property_id, access_request_id, pass_type, subject_type,
        subject_contractor_user_id, subject_vehicle_id,
        valid_from, valid_until, status, approved_by_staff_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
     RETURNING id, pass_type, status, valid_from, valid_until`,
    [
      ar.property_id,
      ar.id,
      passType,
      subjectType,
      subjectContractorUserId,
      subjectVehicleId,
      ar.starts_at,
      ar.ends_at,
      approvedByStaffId,
    ],
  );
  return rows[0];
}

async function resolveCreator({ queryable, user }) {
  if (isStaff(user?.role)) {
    const staffId = await resolveStaffIdByUid(queryable, user.uid);
    if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
    return {
      created_by_type: 'staff',
      created_by_resident_id: null,
      created_by_staff_id: staffId,
      created_by_contractor_user_id: null,
    };
  }
  if (isContractorRole(user?.role)) {
    const contractorUserId = await resolveContractorUserIdByUid(queryable, user.uid);
    if (!contractorUserId) throw serviceError(403, 'Contractor identity is not mapped to v1');
    return {
      created_by_type: 'contractor',
      created_by_resident_id: null,
      created_by_staff_id: null,
      created_by_contractor_user_id: contractorUserId,
    };
  }

  const residentId = await resolveResidentIdByUid(queryable, user?.uid);
  if (!residentId) throw serviceError(403, 'Resident identity is not mapped to v1');
  return {
    created_by_type: 'resident',
    created_by_resident_id: residentId,
    created_by_staff_id: null,
    created_by_contractor_user_id: null,
  };
}

async function createAccessRequest({
  queryable,
  txPool,
  property,
  user,
  input,
}) {
  const creator = await resolveCreator({ queryable, user });
  const approvalRequired = shouldRequireManualApproval({
    property,
    requestType: input.request_type,
    startsAt: input.starts_at,
    endsAt: input.ends_at,
  });
  const initialStatus = approvalRequired ? 'pending_approval' : 'approved';
  const approvedAt = approvalRequired ? null : new Date().toISOString();

  const client = await txPool.connect();
  let accessRequest;
  let pass = null;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO access_requests
         (property_id, created_by_type,
          created_by_resident_id, created_by_staff_id, created_by_contractor_user_id,
          request_type, visitor_name, visitor_phone, vehicle_id,
          target_zone_id, target_point_id, target_unit_id,
          reason, starts_at, ends_at, approval_required, status, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING ${AR_COLS}`,
      [
        input.property_id, creator.created_by_type,
        creator.created_by_resident_id, creator.created_by_staff_id, creator.created_by_contractor_user_id,
        input.request_type, input.visitor_name, input.visitor_phone, input.vehicle_id,
        input.target_zone_id, input.target_point_id, input.target_unit_id,
        input.reason, input.starts_at, input.ends_at, approvalRequired, initialStatus, approvedAt,
      ],
    );
    accessRequest = rows[0];
    if (!approvalRequired) {
      pass = await insertPassForAccessRequest(client, accessRequest);
    }
    await client.query('COMMIT');
  } catch (txErr) {
    try { await client.query('ROLLBACK'); } catch {}
    throw txErr;
  } finally {
    client.release();
  }

  return { access_request: accessRequest, pass, approval_required: approvalRequired };
}

async function requireStaffId(client, user) {
  const staffId = await resolveStaffIdByUid(client, user?.uid);
  if (!staffId) throw serviceError(403, 'Staff identity is not mapped to v1');
  return staffId;
}

async function approveAccessRequest({ txPool, user, accessRequestId, comment }) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: arRows } = await client.query(
      `SELECT id, property_id, request_type, vehicle_id,
              created_by_contractor_user_id, starts_at, ends_at, status
         FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!arRows[0]) throw serviceError(404, 'Access request not found');
    const ar = arRows[0];
    assertAccessRequestAction(ar.status, 'approve');

    await client.query(
      `INSERT INTO access_approvals
         (access_request_id, approver_type, approver_staff_id, decision, comment)
       VALUES ($1, 'staff', $2, 'approved', $3)`,
      [ar.id, staffId, comment],
    );
    const { rows: updatedArRows } = await client.query(
      `UPDATE access_requests
          SET status = 'approved', approved_at = NOW(), updated_at = NOW()
        WHERE id = $1
        RETURNING ${AR_COLS}`,
      [ar.id],
    );

    const pass = await insertPassForAccessRequest(client, ar, staffId);
    await client.query('COMMIT');
    return { access_request: updatedArRows[0], pass };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function rejectAccessRequest({ txPool, user, accessRequestId, comment }) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: curRows } = await client.query(
      `SELECT status FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    assertAccessRequestAction(curRows[0].status, 'reject');

    await client.query(
      `INSERT INTO access_approvals
         (access_request_id, approver_type, approver_staff_id, decision, comment)
       VALUES ($1, 'staff', $2, 'rejected', $3)`,
      [accessRequestId, staffId, comment],
    );
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = 'rejected', rejected_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING ${AR_COLS}`,
      [accessRequestId],
    );
    await client.query('COMMIT');
    return { access_request: rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function cancelAccessRequest({ txPool, user, accessRequestId, isPropertyAdmin }) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT status, created_by_resident_id, created_by_contractor_user_id
         FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    if (!isPropertyAdmin) {
      if (isContractorRole(user?.role)) {
        const contractorUserId = await resolveContractorUserIdByUid(client, user.uid);
        if (!contractorUserId || curRows[0].created_by_contractor_user_id !== contractorUserId) {
          throw serviceError(403, 'Forbidden');
        }
      } else {
        const residentId = await resolveResidentIdByUid(client, user?.uid);
        if (!residentId || curRows[0].created_by_resident_id !== residentId) {
          throw serviceError(403, 'Forbidden');
        }
      }
    }
    assertAccessRequestAction(curRows[0].status, 'cancel');
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 RETURNING ${AR_COLS}`,
      [accessRequestId],
    );
    await client.query('COMMIT');
    return { access_request: rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function escalateAccessRequest({ txPool, user, accessRequestId, comment }) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: curRows } = await client.query(
      `SELECT status FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    assertAccessRequestAction(curRows[0].status, 'escalate');

    await client.query(
      `INSERT INTO access_approvals
         (access_request_id, approver_type, approver_staff_id, decision, comment)
       VALUES ($1, 'staff', $2, 'escalated', $3)`,
      [accessRequestId, staffId, comment],
    );
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = 'escalated', updated_at = NOW()
        WHERE id = $1 RETURNING ${AR_COLS}`,
      [accessRequestId],
    );
    await client.query('COMMIT');
    return { access_request: rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  AR_COLS,
  AccessRequestServiceError,
  createAccessRequest,
  approveAccessRequest,
  rejectAccessRequest,
  cancelAccessRequest,
  escalateAccessRequest,
  insertPassForAccessRequest,
  isAccessRequestServiceError,
  shouldRequireManualApproval,
};
