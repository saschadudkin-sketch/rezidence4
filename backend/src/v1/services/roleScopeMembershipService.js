'use strict';

const { normalizeRole } = require('../lib/authz');
const {
  resolveContractorUserIdByUid,
  resolveResidentIdByUid,
  resolveStaffIdByUid,
} = require('./accessActorResolver');

const MEMBERSHIP_COLS = `
  id, property_id, resident_id, staff_user_id, contractor_user_id,
  external_subject_type, external_subject_id, management_company_id,
  role, scope_level, scope_id, status, starts_at, ends_at,
  created_by_staff_id, provisioned_from, provisioned_at,
  revoked_at, revoked_reason, created_at, updated_at
`;

class RoleScopeMembershipServiceError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'RoleScopeMembershipServiceError';
    this.status = status;
  }
}

function serviceError(status, message) {
  return new RoleScopeMembershipServiceError(status, message);
}

function isRoleScopeMembershipServiceError(err) {
  return err instanceof RoleScopeMembershipServiceError;
}

function subjectField(subjectType) {
  if (subjectType === 'resident') return 'resident_id';
  if (subjectType === 'staff') return 'staff_user_id';
  if (subjectType === 'contractor') return 'contractor_user_id';
  if (subjectType === 'external') return 'external_subject_id';
  throw serviceError(400, 'Invalid membership subject_type');
}

function normalizeScopeInput(input = {}) {
  const scopeLevel = input.scope_level || 'property';
  const scopeId = scopeLevel === 'property' || scopeLevel === 'platform'
    ? null
    : input.scope_id || input.management_company_id || null;
  return {
    scope_level: scopeLevel,
    scope_id: scopeId,
    management_company_id: input.management_company_id || (scopeLevel === 'management_company' ? scopeId : null),
  };
}

function activeWindowSql(alias = 'm') {
  return `${alias}.status = 'active'
    AND ${alias}.starts_at <= NOW()
    AND (${alias}.ends_at IS NULL OR ${alias}.ends_at > NOW())`;
}

async function resolveActorSubject(queryable, user) {
  const role = normalizeRole(user?.role);
  if (!user?.uid || !role) return null;

  if (role === 'resident') {
    const residentId = await resolveResidentIdByUid(queryable, user.uid);
    if (!residentId) return null;
    const { rows } = await queryable.query(
      `SELECT id, property_id FROM residents WHERE id = $1 AND is_active = true`,
      [residentId],
    );
    return rows[0] ? { subject_type: 'resident', subject_id: rows[0].id, property_id: rows[0].property_id, role } : null;
  }

  if (role === 'contractor') {
    const contractorUserId = await resolveContractorUserIdByUid(queryable, user.uid);
    if (!contractorUserId) return null;
    const { rows } = await queryable.query(
      `SELECT id, property_id FROM contractor_users WHERE id = $1 AND is_active = true`,
      [contractorUserId],
    );
    return rows[0] ? { subject_type: 'contractor', subject_id: rows[0].id, property_id: rows[0].property_id, role } : null;
  }

  if (['security', 'concierge', 'technician', 'property_admin', 'management_company_admin', 'platform_admin'].includes(role)) {
    const staffId = await resolveStaffIdByUid(queryable, user.uid);
    if (staffId) {
      const { rows } = await queryable.query(
        `SELECT id, property_id, role FROM staff_users WHERE id = $1 AND is_active = true`,
        [staffId],
      );
      if (rows[0]) {
        return {
          subject_type: 'staff',
          subject_id: rows[0].id,
          property_id: rows[0].property_id,
          role: normalizeRole(rows[0].role) || role,
        };
      }
    }

    if (role === 'management_company_admin' || role === 'platform_admin') {
      return {
        subject_type: 'external',
        subject_id: user.uid,
        external_subject_type: role,
        property_id: user.property_id || user.propertyId || null,
        management_company_id: user.management_company_id || user.managementCompanyId || null,
        role,
      };
    }
  }

  return null;
}

async function listActiveMembershipsForUser({ queryable, user, propertyId = null }) {
  const actor = await resolveActorSubject(queryable, user);
  if (!actor) return [];

  const params = [];
  const filters = [activeWindowSql('m')];
  if (propertyId) {
    params.push(propertyId);
    filters.push(`m.property_id = $${params.length}`);
  }

  if (actor.subject_type === 'external') {
    params.push(actor.external_subject_type, actor.subject_id);
    filters.push(`m.external_subject_type = $${params.length - 1}`);
    filters.push(`m.external_subject_id = $${params.length}`);
  } else {
    const field = subjectField(actor.subject_type);
    params.push(actor.subject_id);
    filters.push(`m.${field} = $${params.length}`);
  }

  const { rows } = await queryable.query(
    `SELECT ${MEMBERSHIP_COLS}
       FROM role_scope_memberships m
      WHERE ${filters.join(' AND ')}
      ORDER BY starts_at DESC, created_at DESC`,
    params,
  );
  return rows;
}

function ensureSubjectInput(input) {
  const subjectType = input.subject_type;
  const field = subjectField(subjectType);
  const subjectId = input[field] || input.subject_id || null;
  if (!subjectId) throw serviceError(400, `${field} required`);
  if (subjectType === 'external' && !input.external_subject_type) {
    throw serviceError(400, 'external_subject_type required');
  }
  return { subjectType, field, subjectId };
}

async function provisionMembership({ queryable, input }) {
  if (!input?.property_id) throw serviceError(400, 'property_id required');
  const role = normalizeRole(input.role);
  if (!role) throw serviceError(400, 'role required');
  const { subjectType, field, subjectId } = ensureSubjectInput(input);
  const scope = normalizeScopeInput(input);

  const params = [
    input.property_id,
    role,
    scope.scope_level,
    scope.scope_id,
    scope.management_company_id,
  ];
  const filters = [
    'property_id = $1',
    'role = $2',
    'scope_level = $3',
    'scope_id IS NOT DISTINCT FROM $4',
    'management_company_id IS NOT DISTINCT FROM $5',
    "status = 'active'",
  ];
  if (subjectType === 'external') {
    params.push(input.external_subject_type, subjectId);
    filters.push(`external_subject_type = $${params.length - 1}`);
    filters.push(`external_subject_id = $${params.length}`);
  } else {
    params.push(subjectId);
    filters.push(`${field} = $${params.length}`);
  }

  const existing = await queryable.query(
    `SELECT ${MEMBERSHIP_COLS}
       FROM role_scope_memberships
      WHERE ${filters.join(' AND ')}
      LIMIT 1`,
    params,
  );
  if (existing.rows[0]) return existing.rows[0];

  const values = {
    resident_id: null,
    staff_user_id: null,
    contractor_user_id: null,
    external_subject_type: null,
    external_subject_id: null,
  };
  if (subjectType === 'external') {
    values.external_subject_type = input.external_subject_type;
    values.external_subject_id = subjectId;
  } else {
    values[field] = subjectId;
  }

  const { rows } = await queryable.query(
    `INSERT INTO role_scope_memberships
       (property_id, resident_id, staff_user_id, contractor_user_id,
        external_subject_type, external_subject_id, management_company_id,
        role, scope_level, scope_id, status, starts_at, ends_at,
        created_by_staff_id, provisioned_from)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',COALESCE($11::timestamptz, NOW()),$12,$13,$14)
     RETURNING ${MEMBERSHIP_COLS}`,
    [
      input.property_id,
      values.resident_id,
      values.staff_user_id,
      values.contractor_user_id,
      values.external_subject_type,
      values.external_subject_id,
      scope.management_company_id,
      role,
      scope.scope_level,
      scope.scope_id,
      input.starts_at || null,
      input.ends_at || null,
      input.created_by_staff_id || null,
      input.provisioned_from || 'api',
    ],
  );
  return rows[0];
}

async function provisionResidentMembership({ queryable, resident, createdByStaffId = null, provisionedFrom = 'api' }) {
  return provisionMembership({
    queryable,
    input: {
      property_id: resident.property_id,
      subject_type: 'resident',
      resident_id: resident.id,
      role: 'resident',
      scope_level: 'property',
      created_by_staff_id: createdByStaffId,
      provisioned_from: provisionedFrom,
    },
  });
}

async function provisionStaffMembership({ queryable, staff, createdByStaffId = null, provisionedFrom = 'api' }) {
  return provisionMembership({
    queryable,
    input: {
      property_id: staff.property_id,
      subject_type: 'staff',
      staff_user_id: staff.id,
      role: staff.role,
      scope_level: 'property',
      created_by_staff_id: createdByStaffId,
      provisioned_from: provisionedFrom,
    },
  });
}

async function provisionContractorMembership({ queryable, contractorUser, createdByStaffId = null, provisionedFrom = 'api' }) {
  return provisionMembership({
    queryable,
    input: {
      property_id: contractorUser.property_id,
      subject_type: 'contractor',
      contractor_user_id: contractorUser.id,
      role: 'contractor',
      scope_level: 'property',
      starts_at: new Date().toISOString(),
      ends_at: contractorUser.access_expires_at || null,
      created_by_staff_id: createdByStaffId,
      provisioned_from: provisionedFrom,
    },
  });
}

async function revokeMembership({ queryable, membershipId, reason = null }) {
  const { rows } = await queryable.query(
    `UPDATE role_scope_memberships
        SET status = 'revoked',
            revoked_at = NOW(),
            revoked_reason = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING ${MEMBERSHIP_COLS}`,
    [reason, membershipId],
  );
  if (!rows[0]) throw serviceError(404, 'Membership not found');
  return rows[0];
}

async function suspendMembershipsForSubject({ queryable, subjectType, subjectId, reason = null }) {
  const field = subjectField(subjectType);
  const params = [reason, subjectId];
  const { rows } = await queryable.query(
    `UPDATE role_scope_memberships
        SET status = 'suspended',
            revoked_at = NOW(),
            revoked_reason = $1,
            updated_at = NOW()
      WHERE ${field} = $2
        AND status = 'active'
      RETURNING ${MEMBERSHIP_COLS}`,
    params,
  );
  return rows;
}

async function listMemberships({ queryable, propertyId, pagination }) {
  const { rows } = await queryable.query(
    `SELECT ${MEMBERSHIP_COLS}
       FROM role_scope_memberships
      WHERE property_id = $1
      ORDER BY status ASC, role ASC, created_at DESC
      LIMIT $2 OFFSET $3`,
    [propertyId, pagination.limit, pagination.offset],
  );
  return rows;
}

module.exports = {
  MEMBERSHIP_COLS,
  RoleScopeMembershipServiceError,
  isRoleScopeMembershipServiceError,
  listActiveMembershipsForUser,
  listMemberships,
  provisionContractorMembership,
  provisionMembership,
  provisionResidentMembership,
  provisionStaffMembership,
  revokeMembership,
  suspendMembershipsForSubject,
};
