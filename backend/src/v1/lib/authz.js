'use strict';

const {
  ROLES: LEGACY_ROLES,
} = require('../../constants');

const FINAL_ROLES = Object.freeze({
  RESIDENT: 'resident',
  SECURITY: 'security',
  CONCIERGE: 'concierge',
  TECHNICIAN: 'technician',
  CONTRACTOR: 'contractor',
  PROPERTY_ADMIN: 'property_admin',
  MANAGEMENT_COMPANY_ADMIN: 'management_company_admin',
  PLATFORM_ADMIN: 'platform_admin',
});

const LEGACY_ROLE_TO_FINAL_ROLE = Object.freeze({
  [LEGACY_ROLES.OWNER]: FINAL_ROLES.RESIDENT,
  [LEGACY_ROLES.TENANT]: FINAL_ROLES.RESIDENT,
  [LEGACY_ROLES.ADMIN]: FINAL_ROLES.PROPERTY_ADMIN,
  [LEGACY_ROLES.SECURITY]: FINAL_ROLES.SECURITY,
  [LEGACY_ROLES.CONCIERGE]: FINAL_ROLES.CONCIERGE,
  [LEGACY_ROLES.CONTRACTOR]: FINAL_ROLES.CONTRACTOR,
  [FINAL_ROLES.RESIDENT]: FINAL_ROLES.RESIDENT,
  [FINAL_ROLES.SECURITY]: FINAL_ROLES.SECURITY,
  [FINAL_ROLES.CONCIERGE]: FINAL_ROLES.CONCIERGE,
  [FINAL_ROLES.TECHNICIAN]: FINAL_ROLES.TECHNICIAN,
  [FINAL_ROLES.CONTRACTOR]: FINAL_ROLES.CONTRACTOR,
  [FINAL_ROLES.PROPERTY_ADMIN]: FINAL_ROLES.PROPERTY_ADMIN,
  [FINAL_ROLES.MANAGEMENT_COMPANY_ADMIN]: FINAL_ROLES.MANAGEMENT_COMPANY_ADMIN,
  [FINAL_ROLES.PLATFORM_ADMIN]: FINAL_ROLES.PLATFORM_ADMIN,
});

const SCOPE_LEVELS = Object.freeze([
  'property',
  'building',
  'entrance',
  'floor',
  'unit',
  'parking_zone',
  'access_zone',
  'access_point',
]);

const ADMIN_ROLE_LIST = Object.freeze([
  FINAL_ROLES.PROPERTY_ADMIN,
  FINAL_ROLES.MANAGEMENT_COMPANY_ADMIN,
  FINAL_ROLES.PLATFORM_ADMIN,
]);
const STAFF_ROLE_LIST = Object.freeze([
  FINAL_ROLES.SECURITY,
  FINAL_ROLES.CONCIERGE,
  FINAL_ROLES.TECHNICIAN,
  ...ADMIN_ROLE_LIST,
]);

const STAFF_ROLES = new Set(STAFF_ROLE_LIST);
const RESIDENT_ROLES = new Set([FINAL_ROLES.RESIDENT]);
const ADMIN_ROLES = new Set(ADMIN_ROLE_LIST);

function normalizeRole(role) {
  return LEGACY_ROLE_TO_FINAL_ROLE[role] || role;
}

function userFrom(userOrReq) {
  return userOrReq?.user || userOrReq || null;
}

function userRole(userOrReq) {
  const user = userFrom(userOrReq);
  return normalizeRole(user?.role);
}

function isKnownScopeLevel(scopeLevel) {
  return SCOPE_LEVELS.includes(scopeLevel);
}

function roles(...values) {
  return values.flat().map(normalizeRole);
}

function spec(roleList, options = {}) {
  return Object.freeze({
    roles: roles(roleList),
    staffFlag: options.staffFlag || null,
  });
}

const admin = roles(ADMIN_ROLE_LIST);
const accessStaff = roles(FINAL_ROLES.SECURITY, FINAL_ROLES.CONCIERGE, ADMIN_ROLE_LIST);
const accessOperators = roles(FINAL_ROLES.SECURITY, ADMIN_ROLE_LIST);
const requestCreators = roles(
  FINAL_ROLES.RESIDENT,
  FINAL_ROLES.CONTRACTOR,
  FINAL_ROLES.SECURITY,
  FINAL_ROLES.CONCIERGE,
  ADMIN_ROLE_LIST,
);

const CAPABILITIES = Object.freeze({
  // Phase 3 access catalog from docs/product/specs/domhub-access-core-production-slice-plan.md.
  'access.request.create': spec(requestCreators),
  'access.request.approve': spec(accessStaff),
  'access.request.reject': spec(accessStaff),
  'access.pass.read': spec(roles(FINAL_ROLES.RESIDENT, FINAL_ROLES.CONTRACTOR, accessStaff)),
  'access.pass.revoke': spec(accessOperators),
  'access.pass.block': spec(accessOperators),
  'access.qr.verify': spec(accessOperators),
  'access.plate.verify': spec(accessOperators),
  'access.incident.create': spec(accessStaff),
  'access.incident.resolve': spec(accessStaff),
  'access.override.create': spec(accessOperators),
  'audit.read': spec(admin),

  // Existing v1 route capabilities. Keep these until route call-sites move to the dot catalog.
  'outbox:read': spec(admin),
  'outbox:requeue': spec(admin),
  'outbox:cancel': spec(admin),

  'announcements:read': spec(accessStaff),
  'announcements:publish': spec(admin),
  'announcements:archive': spec(admin),
  'announcements:unpublish_urgent': spec(admin),

  'documents:read': spec(accessStaff),
  'documents:publish': spec(admin),
  'documents:archive': spec(admin),
  'documents:delete': spec(admin),

  'packages:read': spec(accessStaff),
  'packages:manage': spec(admin),

  'notification-log:read': spec(admin),

  'residents:read': spec(accessStaff),
  'residents:write': spec(admin),
  'residents:read_phone': spec(roles(FINAL_ROLES.CONCIERGE, admin), {
    staffFlag: 'can_view_resident_phone',
  }),

  'requests:read': spec(accessStaff),
  'requests:write': spec(accessStaff),
  'requests:approve': spec(accessStaff),
  'requests:escalate': spec(accessStaff),
  'requests:assign': spec(roles(FINAL_ROLES.CONCIERGE, admin), {
    staffFlag: 'can_assign_requests',
  }),

  'passes:read': spec(accessStaff),
  'passes:manage': spec(admin),
  'passes:block': spec(accessOperators),

  'visits:verify': spec(accessOperators),
  'visits:read': spec(accessStaff),

  'incidents:read': spec(accessStaff),
  'incidents:write': spec(accessStaff),
  'incidents:override': spec(admin),

  'staff:read': spec(admin),
  'staff:write': spec(admin),

  'contractors:read': spec(accessStaff),
  'contractors:write': spec(admin),

  'structure:read': spec(accessStaff),
  'structure:write': spec(admin),

  'vehicles:read': spec(accessStaff),
  'vehicles:manage': spec(admin),
});

function can(user, capability) {
  if (!user) return false;

  const capabilitySpec = CAPABILITIES[capability];
  if (!capabilitySpec) {
    throw new Error(`[authz] unknown capability: '${capability}'. Add to CAPABILITIES catalog.`);
  }

  const role = normalizeRole(user.role);
  if (capabilitySpec.roles.includes(role)) return true;
  if (capabilitySpec.staffFlag && STAFF_ROLES.has(role) && user[capabilitySpec.staffFlag] === true) {
    return true;
  }

  return false;
}

function requireCapability(capability, options = {}) {
  if (!(capability in CAPABILITIES)) {
    throw new Error(`[authz] requireCapability: unknown capability '${capability}'`);
  }
  const message = options.message || 'Forbidden';

  return function requireCapabilityMiddleware(req, res, next) {
    if (can(req.user, capability)) return next();
    if (typeof options.onDeny === 'function') {
      return options.onDeny(req, res);
    }
    return res.status(403).json({ error: message });
  };
}

function isAdmin(userOrReq) {
  return ADMIN_ROLES.has(userRole(userOrReq));
}

function isSecurity(userOrReq) {
  const role = userRole(userOrReq);
  return role === FINAL_ROLES.SECURITY || ADMIN_ROLES.has(role);
}

function isStaffOrAdmin(userOrReq) {
  return STAFF_ROLES.has(userRole(userOrReq));
}

function isResidentUser(userOrReq) {
  return userRole(userOrReq) === FINAL_ROLES.RESIDENT;
}

function isStaff(role) {
  return STAFF_ROLES.has(normalizeRole(role));
}

function isResident(role) {
  return normalizeRole(role) === FINAL_ROLES.RESIDENT;
}

function listAllCapabilities() {
  return { ...CAPABILITIES };
}

function listRoleCapabilities() {
  const result = {};
  for (const role of Object.values(FINAL_ROLES)) result[role] = [];

  for (const [capability, capabilitySpec] of Object.entries(CAPABILITIES)) {
    for (const role of capabilitySpec.roles) {
      if (!result[role]) result[role] = [];
      result[role].push(capability);
    }
  }

  for (const role of Object.keys(result)) result[role].sort();
  return result;
}

const ROLE_CAPABILITIES = Object.freeze(listRoleCapabilities());

module.exports = {
  ADMIN_ROLES,
  CAPABILITIES,
  FINAL_ROLES,
  LEGACY_ROLE_TO_FINAL_ROLE,
  RESIDENT_ROLES,
  ROLE_CAPABILITIES,
  ROLES: LEGACY_ROLES,
  SCOPE_LEVELS,
  STAFF_ROLES,
  can,
  isAdmin,
  isKnownScopeLevel,
  isResident,
  isResidentUser,
  isSecurity,
  isStaff,
  isStaffOrAdmin,
  listAllCapabilities,
  listRoleCapabilities,
  normalizeRole,
  requireCapability,
};
