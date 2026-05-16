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
const {
  evaluateAccessPolicy,
} = require('./accessPolicyService');

const AR_COLS = `
  id, property_id, created_by_type,
  created_by_resident_id, created_by_staff_id, created_by_contractor_user_id,
  request_type, visitor_name, visitor_phone, vehicle_id,
  target_zone_id, target_point_id, target_unit_id,
  reason, guest_instructions, guard_notes, share_delivery_channels,
  starts_at, ends_at, status, approval_required,
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

class AccessRequestServiceError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'AccessRequestServiceError';
    this.status = status;
    this.details = details;
  }
}

function serviceError(status, message, details = null) {
  return new AccessRequestServiceError(status, message, details);
}

function isAccessRequestServiceError(err) {
  return err instanceof AccessRequestServiceError || err instanceof StateTransitionError;
}

function getResolvedFeatureFlags(property) {
  return property?.resolvedFlags || resolveFlags(property?.feature_flags, property?.plan);
}

function shouldRequireManualApproval({ property, policyDecision = null }) {
  const flags = getResolvedFeatureFlags(property);
  if (flags.manual_access_approval) return true;
  if (!policyDecision) return true;
  return policyDecision.decision !== 'allow';
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
        zone_id, point_id, policy_id, valid_from, valid_until, status, approved_by_staff_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active', $12)
     RETURNING id, pass_type, status, zone_id, point_id, policy_id, valid_from, valid_until`,
    [
      ar.property_id,
      ar.id,
      passType,
      subjectType,
      subjectContractorUserId,
      subjectVehicleId,
      ar.target_zone_id || null,
      ar.target_point_id || null,
      ar.policy_id || null,
      ar.starts_at,
      ar.ends_at,
      approvedByStaffId,
    ],
  );
  return rows[0];
}

function getRequestPolicyContext(input, creator) {
  const { subjectType } = getPassSubject({
    requestType: input.request_type,
    vehicleId: input.vehicle_id,
    contractorUserId: creator.created_by_contractor_user_id,
  });
  return {
    subjectType,
    passType: REQUEST_TO_PASS_TYPE[input.request_type],
    accessMethod: input.vehicle_id || input.request_type === 'vehicle_access' ? 'plate' : 'qr',
  };
}

async function loadPolicyVehicle(queryable, { propertyId, vehicleId }) {
  if (!vehicleId) return null;
  const { rows } = await queryable.query(
    `SELECT id, property_id, owner_type, vehicle_type, is_whitelisted, is_blacklisted
       FROM vehicles
      WHERE id = $1 AND property_id = $2`,
    [vehicleId, propertyId],
  );
  if (!rows[0]) throw serviceError(404, 'Vehicle not found');
  return rows[0];
}

async function evaluateAccessRequestPolicy({ queryable, property, input, creator }) {
  const policyContext = getRequestPolicyContext(input, creator);
  const vehicle = await loadPolicyVehicle(queryable, {
    propertyId: input.property_id,
    vehicleId: input.vehicle_id || null,
  });
  const policyDecision = await evaluateAccessPolicy({
    queryable,
    propertyId: input.property_id,
    subjectType: policyContext.subjectType,
    passType: policyContext.passType,
    accessMethod: policyContext.accessMethod,
    zoneId: input.target_zone_id || null,
    pointId: input.target_point_id || null,
    vehicle,
    now: input.starts_at ? new Date(input.starts_at) : new Date(),
  });

  if (policyDecision.decision === 'deny' || policyDecision.decision === 'incident_required') {
    throw serviceError(422, `Access request violates policy: ${policyDecision.reason}`);
  }

  return {
    policyDecision,
    approvalRequired: shouldRequireManualApproval({ property, policyDecision }),
  };
}

const LINKED_SERVICE_REQUEST_TYPES = new Set(['contractor_access']);
const LINKED_REQUEST_TERMINAL_STATUSES = new Set(['completed', 'cancelled', 'rejected', 'expired']);

function validateLinkedServiceRequestRow({ linkedRequest, input, creator }) {
  if (LINKED_REQUEST_TERMINAL_STATUSES.has(linkedRequest.status)) {
    throw serviceError(409, `Linked service request is already ${linkedRequest.status}`);
  }
  if (creator.created_by_contractor_user_id
    && linkedRequest.assigned_contractor_user_id
    && String(linkedRequest.assigned_contractor_user_id) !== String(creator.created_by_contractor_user_id)) {
    throw serviceError(403, 'Linked service request is assigned to another contractor');
  }
  if (linkedRequest.resolution_due_at && new Date(input.ends_at) > new Date(linkedRequest.resolution_due_at)) {
    throw serviceError(422, 'Access window cannot outlive linked service request resolution_due_at');
  }
}

async function validateLinkedServiceRequest(queryable, { input, creator }) {
  const requestId = input.request_id || null;
  if (!requestId) {
    if (LINKED_SERVICE_REQUEST_TYPES.has(input.request_type)) {
      throw serviceError(422, `${input.request_type} requires linked request_id`);
    }
    return;
  }
  const { rows } = await queryable.query(
    `SELECT id, status, assigned_contractor_user_id, resolution_due_at
       FROM requests
      WHERE id = $1
        AND deleted_at IS NULL`,
    [requestId],
  );
  const linkedRequest = rows[0];
  if (!linkedRequest) throw serviceError(404, 'Linked service request not found');
  validateLinkedServiceRequestRow({ linkedRequest, input, creator });
}

async function validateExistingLinkedServiceRequest(queryable, { accessRequestId, input, creator }) {
  if (!LINKED_SERVICE_REQUEST_TYPES.has(input.request_type)) return;
  const { rows } = await queryable.query(
    `SELECT r.id, r.status, r.assigned_contractor_user_id, r.resolution_due_at
       FROM request_access_links ral
       JOIN requests r ON r.id = ral.request_id
      WHERE ral.access_request_id = $1
        AND r.deleted_at IS NULL
      ORDER BY ral.created_at DESC
      LIMIT 1`,
    [accessRequestId],
  );
  if (!rows[0]) throw serviceError(409, `${input.request_type} requires linked service request`);
  validateLinkedServiceRequestRow({ linkedRequest: rows[0], input, creator });
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
  await validateLinkedServiceRequest(queryable, { input, creator });
  const { policyDecision, approvalRequired } = await evaluateAccessRequestPolicy({
    queryable,
    property,
    input,
    creator,
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
          reason, guest_instructions, guard_notes, share_delivery_channels,
          starts_at, ends_at, approval_required, status, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21)
       RETURNING ${AR_COLS}`,
      [
        input.property_id, creator.created_by_type,
        creator.created_by_resident_id, creator.created_by_staff_id, creator.created_by_contractor_user_id,
        input.request_type, input.visitor_name, input.visitor_phone, input.vehicle_id,
        input.target_zone_id, input.target_point_id, input.target_unit_id,
        input.reason, input.guest_instructions, input.guard_notes,
        JSON.stringify(input.share_delivery_channels || []),
        input.starts_at, input.ends_at, approvalRequired, initialStatus, approvedAt,
      ],
    );
    accessRequest = rows[0];
    accessRequest.policy_id = policyDecision.matched_policy_id || null;
    if (input.request_id) {
      await client.query(
        `INSERT INTO request_access_links (request_id, access_request_id)
         VALUES ($1, $2)
         ON CONFLICT (request_id, access_request_id) DO NOTHING`,
        [input.request_id, accessRequest.id],
      );
    }
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

function assertExpectedStatus(currentStatus, expectedCurrentStatus) {
  if (!expectedCurrentStatus) return;
  if (currentStatus !== expectedCurrentStatus) {
    throw serviceError(409, 'Access request status changed', {
      currentStatus,
      expectedCurrentStatus,
    });
  }
}

async function enqueueAccessEvent(client, {
  propertyId,
  eventType,
  correlationId,
  payload,
}) {
  await client.query(
    `INSERT INTO notifications_outbox
       (property_id, event_type, channel, recipient_type, payload, correlation_id)
     VALUES ($1, $2, 'webhook', 'external', $3, $4)`,
    [
      propertyId,
      eventType,
      JSON.stringify(payload || {}),
      correlationId || null,
    ],
  );
}

async function approveAccessRequest({
  txPool,
  user,
  accessRequestId,
  comment,
  expectedCurrentStatus = null,
}) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: arRows } = await client.query(
      `SELECT id, property_id, request_type, vehicle_id,
              created_by_contractor_user_id, target_zone_id, target_point_id,
              starts_at, ends_at, status
         FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!arRows[0]) throw serviceError(404, 'Access request not found');
    const ar = arRows[0];
    assertExpectedStatus(ar.status, expectedCurrentStatus);
    assertAccessRequestAction(ar.status, 'approve');
    await validateExistingLinkedServiceRequest(client, {
      accessRequestId: ar.id,
      input: {
        request_type: ar.request_type,
        ends_at: ar.ends_at,
      },
      creator: {
        created_by_contractor_user_id: ar.created_by_contractor_user_id,
      },
    });
    const { policyDecision } = await evaluateAccessRequestPolicy({
      queryable: client,
      property: null,
      input: {
        property_id: ar.property_id,
        request_type: ar.request_type,
        vehicle_id: ar.vehicle_id,
        target_zone_id: ar.target_zone_id,
        target_point_id: ar.target_point_id,
        starts_at: ar.starts_at,
      },
      creator: {
        created_by_contractor_user_id: ar.created_by_contractor_user_id,
      },
    });

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

    const pass = await insertPassForAccessRequest(
      client,
      { ...ar, policy_id: policyDecision.matched_policy_id || null },
      staffId,
    );
    await enqueueAccessEvent(client, {
      propertyId: ar.property_id,
      eventType: 'access.request.approved',
      correlationId: ar.id,
      payload: {
        access_request_id: ar.id,
        pass_id: pass.id,
        previous_status: ar.status,
        status: 'approved',
      },
    });
    await client.query('COMMIT');
    return { access_request: updatedArRows[0], pass };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function submitAccessRequest({ txPool, accessRequestId, expectedCurrentStatus = null }) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT status FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    assertExpectedStatus(curRows[0].status, expectedCurrentStatus);
    if (curRows[0].status !== 'new') {
      throw serviceError(409, `Cannot submit from status '${curRows[0].status}'`);
    }
    const { rows } = await client.query(
      `UPDATE access_requests
          SET status = 'pending_approval', updated_at = NOW()
        WHERE id = $1
        RETURNING ${AR_COLS}`,
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

async function rejectAccessRequest({
  txPool,
  user,
  accessRequestId,
  comment,
  expectedCurrentStatus = null,
}) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: curRows } = await client.query(
      `SELECT status FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    assertExpectedStatus(curRows[0].status, expectedCurrentStatus);
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
    await enqueueAccessEvent(client, {
      propertyId: rows[0].property_id,
      eventType: 'access.request.rejected',
      correlationId: accessRequestId,
      payload: {
        access_request_id: accessRequestId,
        previous_status: curRows[0].status,
        status: 'rejected',
      },
    });
    await client.query('COMMIT');
    return { access_request: rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function cancelAccessRequest({
  txPool,
  user,
  accessRequestId,
  isPropertyAdmin,
  expectedCurrentStatus = null,
}) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: curRows } = await client.query(
      `SELECT status, created_by_resident_id, created_by_contractor_user_id
         FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    assertExpectedStatus(curRows[0].status, expectedCurrentStatus);
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
    await enqueueAccessEvent(client, {
      propertyId: rows[0].property_id,
      eventType: 'access.request.cancelled',
      correlationId: accessRequestId,
      payload: {
        access_request_id: accessRequestId,
        previous_status: curRows[0].status,
        status: 'cancelled',
      },
    });
    await client.query('COMMIT');
    return { access_request: rows[0] };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

async function escalateAccessRequest({
  txPool,
  user,
  accessRequestId,
  comment,
  expectedCurrentStatus = null,
}) {
  const client = await txPool.connect();
  try {
    await client.query('BEGIN');
    const staffId = await requireStaffId(client, user);
    const { rows: curRows } = await client.query(
      `SELECT status FROM access_requests WHERE id = $1 FOR UPDATE`,
      [accessRequestId],
    );
    if (!curRows[0]) throw serviceError(404, 'Access request not found');
    assertExpectedStatus(curRows[0].status, expectedCurrentStatus);
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
    await enqueueAccessEvent(client, {
      propertyId: rows[0].property_id,
      eventType: 'access.request.escalated',
      correlationId: accessRequestId,
      payload: {
        access_request_id: accessRequestId,
        previous_status: curRows[0].status,
        status: 'escalated',
      },
    });
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
  submitAccessRequest,
  approveAccessRequest,
  rejectAccessRequest,
  cancelAccessRequest,
  escalateAccessRequest,
  insertPassForAccessRequest,
  isAccessRequestServiceError,
  shouldRequireManualApproval,
};
