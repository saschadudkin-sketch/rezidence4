'use strict';

const POLICY_COLS = `
  id, property_id, name, subject_type, subject_role, zone_id, point_id,
  access_method, approval_mode, effect, priority, schedule_json,
  duration_minutes, is_recurring, is_active, created_by, metadata,
  created_at, updated_at
`;

const SUBJECT_TYPES = new Set([
  'resident',
  'guest',
  'staff',
  'contractor',
  'vehicle',
  'courier',
]);
const ENABLED_ACCESS_METHODS = new Set(['qr', 'manual', 'plate', 'ble', 'card', 'pin']);
const DORMANT_ACCESS_METHODS = new Set(['face']);
const ACCESS_METHODS = new Set([...ENABLED_ACCESS_METHODS, ...DORMANT_ACCESS_METHODS]);
const APPROVAL_MODES = new Set(['auto', 'required', 'security_only', 'admin_only']);
const POLICY_EFFECTS = new Set([
  'allow',
  'deny',
  'needs_approval',
  'needs_security_review',
  'incident_required',
]);

const DEFAULT_POLICY_TEMPLATES = Object.freeze([
  Object.freeze({
    key: 'resident_vehicle',
    name: 'Resident vehicle access',
    subject_type: 'vehicle',
    access_method: 'plate',
    approval_mode: 'auto',
    effect: 'allow',
    priority: 20,
    is_recurring: true,
    schedule_json: null,
    duration_minutes: null,
    metadata: { template: true, use_case: 'resident_vehicle', owner_type: 'resident' },
  }),
  Object.freeze({
    key: 'guest_vehicle',
    name: 'Guest vehicle access',
    subject_type: 'vehicle',
    access_method: 'plate',
    approval_mode: 'required',
    effect: 'allow',
    priority: 40,
    is_recurring: false,
    schedule_json: null,
    duration_minutes: 1440,
    metadata: { template: true, use_case: 'guest_vehicle', owner_type: 'guest' },
  }),
  Object.freeze({
    key: 'courier',
    name: 'Courier access',
    subject_type: 'courier',
    access_method: 'qr',
    approval_mode: 'security_only',
    effect: 'allow',
    priority: 50,
    is_recurring: false,
    schedule_json: {
      timezone: 'Europe/Moscow',
      time_windows: [{ start: '08:00', end: '22:00' }],
    },
    duration_minutes: 120,
    metadata: { template: true, use_case: 'courier' },
  }),
  Object.freeze({
    key: 'contractor_service',
    name: 'Contractor service access',
    subject_type: 'contractor',
    access_method: 'qr',
    approval_mode: 'required',
    effect: 'allow',
    priority: 60,
    is_recurring: false,
    schedule_json: {
      timezone: 'Europe/Moscow',
      time_windows: [{ start: '09:00', end: '19:00' }],
    },
    duration_minutes: 480,
    metadata: { template: true, use_case: 'contractor_service' },
  }),
  Object.freeze({
    key: 'staff_operational',
    name: 'Staff operational access',
    subject_type: 'staff',
    access_method: 'qr',
    approval_mode: 'auto',
    effect: 'allow',
    priority: 30,
    is_recurring: true,
    schedule_json: null,
    duration_minutes: null,
    metadata: { template: true, use_case: 'staff_operational' },
  }),
  Object.freeze({
    key: 'emergency_access',
    name: 'Emergency access',
    subject_type: 'staff',
    access_method: 'manual',
    approval_mode: 'security_only',
    effect: 'needs_security_review',
    priority: 10,
    is_recurring: false,
    schedule_json: null,
    duration_minutes: 60,
    metadata: { template: true, use_case: 'emergency_access' },
  }),
]);

class AccessPolicyServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'AccessPolicyServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new AccessPolicyServiceError(status, message);
}

function isAccessPolicyServiceError(err) {
  return err instanceof AccessPolicyServiceError;
}

function assertEnabledAccessMethod(value, label = 'access_method') {
  if (ENABLED_ACCESS_METHODS.has(value)) return;
  if (DORMANT_ACCESS_METHODS.has(value)) {
    throw serviceError(422, `${label} requires separately approved biometric identity matching`);
  }
  throw serviceError(400, `Invalid ${label}`);
}

function getDefaultPolicyTemplates() {
  return DEFAULT_POLICY_TEMPLATES.map((template) => ({
    ...template,
    metadata: { ...template.metadata },
    schedule_json: template.schedule_json ? JSON.parse(JSON.stringify(template.schedule_json)) : null,
  }));
}

function parseJsonValue(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function normalizePolicyInput(input, { partial = false } = {}) {
  const out = {};

  function requireOrCopyString(key, maxLength, required = false) {
    if (input[key] === undefined) {
      if (!partial && required) throw serviceError(400, `${key} required`);
      return;
    }
    if (input[key] !== null && (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > maxLength)) {
      throw serviceError(400, `${key} must be 1-${maxLength} chars`);
    }
    out[key] = input[key] === null ? null : input[key].trim();
  }

  requireOrCopyString('name', 100, true);
  requireOrCopyString('subject_role', 30, false);

  if (!partial && input.property_id !== undefined) out.property_id = input.property_id;
  if (input.zone_id !== undefined) out.zone_id = input.zone_id || null;
  if (input.point_id !== undefined) out.point_id = input.point_id || null;
  if (!partial && input.created_by !== undefined) out.created_by = input.created_by || null;

  if (input.subject_type !== undefined) {
    if (!SUBJECT_TYPES.has(input.subject_type)) throw serviceError(400, 'Invalid subject_type');
    out.subject_type = input.subject_type;
  } else if (!partial) {
    throw serviceError(400, 'subject_type required');
  }

  if (input.access_method !== undefined) {
    assertEnabledAccessMethod(input.access_method);
    out.access_method = input.access_method;
  } else if (!partial) {
    throw serviceError(400, 'access_method required');
  }

  if (input.approval_mode !== undefined) {
    if (!APPROVAL_MODES.has(input.approval_mode)) throw serviceError(400, 'Invalid approval_mode');
    out.approval_mode = input.approval_mode;
  } else if (!partial) {
    out.approval_mode = 'required';
  }

  if (input.effect !== undefined) {
    if (!POLICY_EFFECTS.has(input.effect)) throw serviceError(400, 'Invalid effect');
    out.effect = input.effect;
  } else if (!partial) {
    out.effect = 'allow';
  }

  if (input.priority !== undefined) {
    if (!Number.isInteger(input.priority)) throw serviceError(400, 'priority must be integer');
    out.priority = input.priority;
  } else if (!partial) {
    out.priority = 100;
  }

  if (input.duration_minutes !== undefined) {
    if (input.duration_minutes !== null && (!Number.isInteger(input.duration_minutes) || input.duration_minutes <= 0)) {
      throw serviceError(400, 'duration_minutes must be positive integer or null');
    }
    out.duration_minutes = input.duration_minutes;
  }

  if (input.is_recurring !== undefined) {
    if (typeof input.is_recurring !== 'boolean') throw serviceError(400, 'is_recurring must be boolean');
    out.is_recurring = input.is_recurring;
  } else if (!partial) {
    out.is_recurring = false;
  }

  if (input.is_active !== undefined) {
    if (typeof input.is_active !== 'boolean') throw serviceError(400, 'is_active must be boolean');
    out.is_active = input.is_active;
  }

  if (input.schedule_json !== undefined) {
    if (input.schedule_json !== null && (typeof input.schedule_json !== 'object' || Array.isArray(input.schedule_json))) {
      throw serviceError(400, 'schedule_json must be object or null');
    }
    out.schedule_json = input.schedule_json;
  } else if (!partial) {
    out.schedule_json = null;
  }

  if (input.metadata !== undefined) {
    if (input.metadata === null || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) {
      throw serviceError(400, 'metadata must be object');
    }
    out.metadata = input.metadata;
  } else if (!partial) {
    out.metadata = {};
  }

  return out;
}

async function listPolicies({ queryable, filters, pagination }) {
  const clauses = ['property_id = $1'];
  const params = [filters.property_id];

  for (const [key, column] of [
    ['subject_type', 'subject_type'],
    ['access_method', 'access_method'],
    ['zone_id', 'zone_id'],
    ['point_id', 'point_id'],
    ['effect', 'effect'],
  ]) {
    if (filters[key]) {
      params.push(filters[key]);
      clauses.push(`${column} = $${params.length}`);
    }
  }
  if (filters.is_active !== undefined) {
    params.push(filters.is_active);
    clauses.push(`is_active = $${params.length}`);
  }

  params.push(pagination.limit);
  const limitIdx = params.length;
  params.push(pagination.offset);
  const offsetIdx = params.length;

  const { rows } = await queryable.query(
    `SELECT ${POLICY_COLS}
       FROM access_policies
      WHERE ${clauses.join(' AND ')}
      ORDER BY priority ASC, created_at ASC, id ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );
  return rows;
}

async function getPolicyById({ queryable, policyId }) {
  const { rows } = await queryable.query(
    `SELECT ${POLICY_COLS} FROM access_policies WHERE id = $1`,
    [policyId],
  );
  return rows[0] || null;
}

async function validatePolicyScopeReferences(queryable, { propertyId, zoneId = null, pointId = null }) {
  let zone = null;
  if (zoneId) {
    const { rows } = await queryable.query(
      `SELECT id FROM access_zones
        WHERE id = $1 AND property_id = $2 AND is_active = true
        LIMIT 1`,
      [zoneId, propertyId],
    );
    if (!rows[0]) throw serviceError(400, 'zone_id does not exist for this property');
    zone = rows[0];
  }

  if (pointId) {
    const { rows } = await queryable.query(
      `SELECT id, zone_id FROM access_points
        WHERE id = $1 AND property_id = $2 AND is_active = true
        LIMIT 1`,
      [pointId, propertyId],
    );
    if (!rows[0]) throw serviceError(400, 'point_id does not exist for this property');
    if (zone && rows[0].zone_id !== zone.id) {
      throw serviceError(400, 'point_id does not belong to zone_id');
    }
  }
}

async function createPolicy({ queryable, input }) {
  const policy = normalizePolicyInput(input);
  await validatePolicyScopeReferences(queryable, {
    propertyId: policy.property_id,
    zoneId: policy.zone_id || null,
    pointId: policy.point_id || null,
  });
  const { rows } = await queryable.query(
    `INSERT INTO access_policies
       (property_id, name, subject_type, subject_role, zone_id, point_id,
        access_method, approval_mode, effect, priority, schedule_json,
        duration_minutes, is_recurring, is_active, created_by, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16::jsonb)
     RETURNING ${POLICY_COLS}`,
    [
      policy.property_id,
      policy.name,
      policy.subject_type,
      policy.subject_role || null,
      policy.zone_id || null,
      policy.point_id || null,
      policy.access_method,
      policy.approval_mode,
      policy.effect,
      policy.priority,
      policy.schedule_json ? JSON.stringify(policy.schedule_json) : null,
      policy.duration_minutes ?? null,
      policy.is_recurring,
      policy.is_active ?? true,
      policy.created_by || null,
      JSON.stringify(policy.metadata || {}),
    ],
  );
  return rows[0];
}

async function updatePolicy({ queryable, policyId, input, propertyId = null }) {
  const updates = normalizePolicyInput(input, { partial: true });
  if (propertyId && (updates.zone_id !== undefined || updates.point_id !== undefined)) {
    await validatePolicyScopeReferences(queryable, {
      propertyId,
      zoneId: updates.zone_id || null,
      pointId: updates.point_id || null,
    });
  }
  const sets = [];
  const params = [];

  for (const [key, value] of Object.entries(updates)) {
    params.push(
      key === 'schedule_json'
        ? (value ? JSON.stringify(value) : null)
        : key === 'metadata'
          ? JSON.stringify(value)
          : value,
    );
    const cast = key === 'schedule_json' || key === 'metadata' ? '::jsonb' : '';
    sets.push(`${key} = $${params.length}${cast}`);
  }

  if (!sets.length) throw serviceError(400, 'No updatable fields provided');
  sets.push('updated_at = NOW()');
  params.push(policyId);
  const policyIdIdx = params.length;
  if (propertyId) params.push(propertyId);

  const { rows } = await queryable.query(
    `UPDATE access_policies
        SET ${sets.join(', ')}
      WHERE id = $${policyIdIdx}${propertyId ? ` AND property_id = $${params.length}` : ''}
      RETURNING ${POLICY_COLS}`,
    params,
  );
  if (!rows[0]) throw serviceError(404, 'Access policy not found');
  return rows[0];
}

async function deactivatePolicy({ queryable, policyId, propertyId = null }) {
  const { rows } = await queryable.query(
    `UPDATE access_policies
        SET is_active = false, updated_at = NOW()
      WHERE id = $1${propertyId ? ' AND property_id = $2' : ''}
      RETURNING ${POLICY_COLS}`,
    propertyId ? [policyId, propertyId] : [policyId],
  );
  if (!rows[0]) throw serviceError(404, 'Access policy not found');
  return rows[0];
}

async function resolvePointZoneId(queryable, { propertyId, pointId }) {
  if (!pointId) return null;
  const { rows } = await queryable.query(
    `SELECT zone_id
       FROM access_points
      WHERE id = $1 AND property_id = $2 AND is_active = true
      LIMIT 1`,
    [pointId, propertyId],
  );
  return rows[0]?.zone_id || null;
}

function passTypeToSubjectType(passType) {
  if (passType === 'vehicle') return 'vehicle';
  if (passType === 'contractor' || passType === 'service') return 'contractor';
  if (passType === 'courier') return 'courier';
  if (passType === 'resident') return 'resident';
  if (passType === 'staff' || passType === 'emergency') return 'staff';
  if (passType === 'guest') return 'guest';
  return null;
}

function buildSubjectTypeSet({ subjectType, passType, vehicle }) {
  const values = new Set();
  if (subjectType) values.add(subjectType === 'contractor_user' ? 'contractor' : subjectType);
  const mapped = passTypeToSubjectType(passType);
  if (mapped) values.add(mapped);
  if (vehicle) values.add('vehicle');
  return values;
}

function parseHm(value) {
  if (typeof value !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function getZonedParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone || 'Europe/Moscow',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[byType.weekday],
    minuteOfDay: Number(byType.hour) * 60 + Number(byType.minute),
  };
}

function isWithinTimeWindow(minuteOfDay, window) {
  const start = parseHm(window?.start);
  const end = parseHm(window?.end);
  if (start === null || end === null) return false;
  if (start === end) return true;
  if (start < end) return minuteOfDay >= start && minuteOfDay <= end;
  return minuteOfDay >= start || minuteOfDay <= end;
}

function scheduleMatches(scheduleValue, now) {
  const schedule = parseJsonValue(scheduleValue, null);
  if (!schedule || !Object.keys(schedule).length) {
    return { ok: true, reason: 'no_schedule' };
  }

  if (schedule.valid_from && now < new Date(schedule.valid_from)) {
    return { ok: false, reason: 'before_policy_schedule' };
  }
  if (schedule.valid_until && now > new Date(schedule.valid_until)) {
    return { ok: false, reason: 'after_policy_schedule' };
  }

  const { weekday, minuteOfDay } = getZonedParts(now, schedule.timezone || 'Europe/Moscow');
  if (Array.isArray(schedule.days_of_week) && schedule.days_of_week.length > 0) {
    if (!schedule.days_of_week.map(Number).includes(weekday)) {
      return { ok: false, reason: 'day_not_allowed' };
    }
  }

  if (Array.isArray(schedule.time_windows) && schedule.time_windows.length > 0) {
    if (!schedule.time_windows.some((window) => isWithinTimeWindow(minuteOfDay, window))) {
      return { ok: false, reason: 'time_window_not_allowed' };
    }
  }

  return { ok: true, reason: 'schedule_match' };
}

function policyScopeMatches(policy, { pointId, zoneId }) {
  if (policy.point_id && policy.point_id !== pointId) return false;
  if (policy.zone_id && policy.zone_id !== zoneId) return false;
  return true;
}

function policyVehicleContextMatches(policy, { vehicle, pass }) {
  if (policy.subject_type !== 'vehicle') return true;
  const metadata = parseJsonValue(policy.metadata, {}) || {};
  if (!metadata || !Object.keys(metadata).length) return true;

  const ownerTypes = Array.isArray(metadata.allowed_owner_types)
    ? metadata.allowed_owner_types
    : Array.isArray(metadata.owner_types)
      ? metadata.owner_types
      : metadata.owner_type
        ? [metadata.owner_type]
        : [];
  if (ownerTypes.length > 0 && !ownerTypes.includes(vehicle?.owner_type || null)) return false;

  const vehicleTypes = Array.isArray(metadata.vehicle_types)
    ? metadata.vehicle_types
    : metadata.vehicle_type
      ? [metadata.vehicle_type]
      : [];
  if (vehicleTypes.length > 0 && !vehicleTypes.includes(vehicle?.vehicle_type || null)) return false;

  if ((metadata.requires_whitelist === true || metadata.whitelist_required === true) && !vehicle?.is_whitelisted) {
    return false;
  }
  if ((metadata.requires_registered_vehicle === true || metadata.registered_vehicle_required === true) && !vehicle?.id) {
    return false;
  }
  if ((metadata.requires_pass === true || metadata.pass_required === true) && !pass?.id) {
    return false;
  }

  return true;
}

function decisionFromPolicy(policy) {
  if (policy.effect !== 'allow') return policy.effect;
  if (policy.approval_mode === 'auto') return 'allow';
  if (policy.approval_mode === 'security_only') return 'needs_security_review';
  return 'needs_approval';
}

function denialShape(decision, reason, policy = null, trace = []) {
  const incidentType = decision === 'needs_security_review'
    ? 'policy_security_review_required'
    : 'policy_denied';
  return {
    allowed: false,
    decision,
    reason,
    incident_type: incidentType,
    severity: decision === 'incident_required' ? 'high' : 'medium',
    matched_policy_id: policy?.id || null,
    matched_policy_name: policy?.name || null,
    trace,
  };
}

async function evaluateAccessPolicy({
  queryable,
  propertyId,
  subjectType = null,
  passType = null,
  accessMethod,
  zoneId = null,
  pointId = null,
  pass = null,
  vehicle = null,
  now = new Date(),
  failOpen = false,
}) {
  if (!propertyId) throw serviceError(400, 'propertyId required');
  assertEnabledAccessMethod(accessMethod, 'accessMethod');

  const scanPointId = pointId || null;
  const passPointId = pass?.point_id || null;
  const passZoneId = pass?.zone_id || null;
  let scanZoneId = zoneId || null;

  if (scanPointId && passPointId && scanPointId !== passPointId) {
    return denialShape('deny', 'policy_point_mismatch', null, [{
      step: 'pass_scope',
      result: 'point_mismatch',
      expected_point_id: passPointId,
      actual_point_id: scanPointId,
    }]);
  }

  if (scanPointId && passZoneId && !scanZoneId) {
    scanZoneId = await resolvePointZoneId(queryable, { propertyId, pointId: scanPointId });
  }

  if (scanPointId && passZoneId && scanZoneId && passZoneId !== scanZoneId) {
    return denialShape('deny', 'policy_zone_mismatch', null, [{
      step: 'pass_scope',
      result: 'zone_mismatch',
      expected_zone_id: passZoneId,
      actual_zone_id: scanZoneId,
    }]);
  }

  const subjectTypes = buildSubjectTypeSet({
    subjectType: subjectType || pass?.subject_type || null,
    passType: passType || pass?.pass_type || null,
    vehicle,
  });

  const { rows } = await queryable.query(
    `SELECT ${POLICY_COLS}
       FROM access_policies
      WHERE property_id = $1
        AND is_active = true
      ORDER BY priority ASC, created_at ASC, id ASC`,
    [propertyId],
  );

  if (!rows.length) {
    if (!failOpen) {
      return denialShape('deny', 'no_active_policies', null, [{
        step: 'active_policy_lookup',
        result: 'none',
      }]);
    }
    return {
      allowed: true,
      decision: 'allow',
      reason: 'no_active_policies',
      matched_policy_id: null,
      matched_policy_name: null,
      trace: [{ step: 'active_policy_lookup', result: 'none' }],
    };
  }

  if (scanPointId && !scanZoneId && rows.some((policy) => policy.zone_id)) {
    scanZoneId = await resolvePointZoneId(queryable, { propertyId, pointId: scanPointId });
  }

  const effectiveZoneId = scanZoneId || passZoneId || null;
  const effectivePointId = scanPointId || passPointId || null;
  const trace = [];
  let firstScheduleMiss = null;
  for (const policy of rows) {
    const policyTrace = {
      step: 'policy_match',
      policy_id: policy.id,
      policy_name: policy.name,
      priority: policy.priority,
      effect: policy.effect,
      approval_mode: policy.approval_mode,
    };

    if (!subjectTypes.has(policy.subject_type === 'contractor_user' ? 'contractor' : policy.subject_type)) {
      trace.push({ ...policyTrace, result: 'subject_mismatch' });
      continue;
    }
    if (policy.access_method !== accessMethod) {
      trace.push({ ...policyTrace, result: 'method_mismatch' });
      continue;
    }
    if (!policyScopeMatches(policy, { pointId: effectivePointId, zoneId: effectiveZoneId })) {
      trace.push({ ...policyTrace, result: 'scope_mismatch' });
      continue;
    }
    if (!policyVehicleContextMatches(policy, { vehicle, pass })) {
      trace.push({ ...policyTrace, result: 'vehicle_context_mismatch' });
      continue;
    }

    const schedule = scheduleMatches(policy.schedule_json, now);
    if (!schedule.ok) {
      const miss = { ...policyTrace, result: 'schedule_mismatch', reason: schedule.reason };
      trace.push(miss);
      firstScheduleMiss = firstScheduleMiss || { policy, miss };
      continue;
    }

    const decision = decisionFromPolicy(policy);
    const matchTrace = { ...policyTrace, result: 'matched', schedule: schedule.reason, decision };
    trace.push(matchTrace);
    if (decision === 'allow') {
      return {
        allowed: true,
        decision,
        reason: 'policy_allowed',
        matched_policy_id: policy.id,
        matched_policy_name: policy.name,
        trace,
      };
    }
    const reason = decision === 'deny'
      ? 'policy_denied'
      : decision === 'needs_approval'
        ? 'policy_approval_required'
        : decision === 'needs_security_review'
          ? 'policy_security_review_required'
          : 'policy_incident_required';
    return denialShape(decision, reason, policy, trace);
  }

  if (firstScheduleMiss) {
    return denialShape('deny', 'outside_policy_schedule', firstScheduleMiss.policy, trace);
  }

  if (!failOpen) {
    return denialShape('deny', 'no_matching_policy', null, trace);
  }

  return {
    allowed: true,
    decision: 'allow',
    reason: 'no_matching_policy',
    matched_policy_id: null,
    matched_policy_name: null,
    trace,
  };
}

module.exports = {
  ACCESS_METHODS,
  ENABLED_ACCESS_METHODS,
  APPROVAL_MODES,
  POLICY_COLS,
  POLICY_EFFECTS,
  SUBJECT_TYPES,
  AccessPolicyServiceError,
  createPolicy,
  deactivatePolicy,
  evaluateAccessPolicy,
  getDefaultPolicyTemplates,
  getPolicyById,
  isAccessPolicyServiceError,
  assertEnabledAccessMethod,
  listPolicies,
  normalizePolicyInput,
  policyVehicleContextMatches,
  scheduleMatches,
  updatePolicy,
};
