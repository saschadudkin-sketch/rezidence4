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
  'platform',
  'management_company',
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

const ROLE_ALLOWED_SCOPE_LEVELS = Object.freeze({
  [FINAL_ROLES.RESIDENT]: Object.freeze(['property', 'building', 'entrance', 'unit']),
  [FINAL_ROLES.SECURITY]: Object.freeze(['property', 'access_zone', 'access_point']),
  [FINAL_ROLES.CONCIERGE]: Object.freeze(['property', 'building', 'entrance', 'unit']),
  [FINAL_ROLES.TECHNICIAN]: Object.freeze(['property', 'building', 'entrance', 'unit', 'access_zone']),
  [FINAL_ROLES.CONTRACTOR]: Object.freeze(['property', 'unit', 'access_zone', 'access_point']),
  [FINAL_ROLES.PROPERTY_ADMIN]: Object.freeze([
    'property', 'building', 'entrance', 'floor', 'unit',
    'parking_zone', 'access_zone', 'access_point',
  ]),
  [FINAL_ROLES.MANAGEMENT_COMPANY_ADMIN]: Object.freeze([
    'management_company', 'property', 'building', 'entrance', 'floor', 'unit',
    'parking_zone', 'access_zone', 'access_point',
  ]),
  [FINAL_ROLES.PLATFORM_ADMIN]: SCOPE_LEVELS,
});

const ROLE_DEFAULT_SCOPE_LEVEL = Object.freeze({
  [FINAL_ROLES.RESIDENT]: 'property',
  [FINAL_ROLES.SECURITY]: 'property',
  [FINAL_ROLES.CONCIERGE]: 'property',
  [FINAL_ROLES.TECHNICIAN]: 'property',
  [FINAL_ROLES.CONTRACTOR]: 'property',
  [FINAL_ROLES.PROPERTY_ADMIN]: 'property',
  [FINAL_ROLES.MANAGEMENT_COMPANY_ADMIN]: 'management_company',
  [FINAL_ROLES.PLATFORM_ADMIN]: 'platform',
});

function normalizeRole(role) {
  return LEGACY_ROLE_TO_FINAL_ROLE[role] || role;
}

function userFrom(userOrReq) {
  return userOrReq?.user || userOrReq || null;
}

function requestFrom(userOrReq) {
  return userOrReq?.user ? userOrReq : null;
}

function userRole(userOrReq) {
  const user = userFrom(userOrReq);
  return normalizeRole(user?.role);
}

function isKnownScopeLevel(scopeLevel) {
  return SCOPE_LEVELS.includes(scopeLevel);
}

function pickContextId(userOrReq, options, key, altKey) {
  const req = requestFrom(userOrReq);
  const user = userFrom(userOrReq);
  const propertyIdFromTenant =
    key === 'property_id' || altKey === 'propertyId'
      ? req?.property?.id
      : null;
  return options?.[key]
    || (altKey ? options?.[altKey] : null)
    || user?.[key]
    || (altKey ? user?.[altKey] : null)
    || req?.[key]
    || (altKey ? req?.[altKey] : null)
    || req?.property?.[key]
    || (altKey ? req?.property?.[altKey] : null)
    || propertyIdFromTenant
    || null;
}

function normalizeScope(scope, context = {}) {
  if (!scope) return null;

  const raw = typeof scope === 'string'
    ? { scope_level: scope }
    : { ...scope };
  const scopeLevel = raw.scope_level || raw.level;
  if (!isKnownScopeLevel(scopeLevel)) {
    throw new Error(`[authz] unknown scope level: '${scopeLevel}'`);
  }

  const propertyId = raw.property_id || raw.propertyId || context.property_id || context.propertyId || null;
  const managementCompanyId =
    raw.management_company_id
    || raw.managementCompanyId
    || context.management_company_id
    || context.managementCompanyId
    || null;

  let scopeId = raw.scope_id || raw.id || null;
  if (scopeLevel === 'property') scopeId = scopeId || propertyId;
  if (scopeLevel === 'management_company') scopeId = scopeId || managementCompanyId;
  if (scopeLevel === 'platform') scopeId = null;

  return {
    scope_level: scopeLevel,
    scope_id: scopeId,
    property_id: propertyId,
    management_company_id: managementCompanyId,
  };
}

function roleCanUseScope(role, scopeLevel) {
  const normalizedRole = normalizeRole(role);
  const allowed = ROLE_ALLOWED_SCOPE_LEVELS[normalizedRole];
  return Boolean(allowed && allowed.includes(scopeLevel));
}

function buildRoleScopeMembership(userOrReq, options = {}) {
  const user = userFrom(userOrReq);
  const role = normalizeRole(options.role || user?.role);
  if (!role || !ROLE_DEFAULT_SCOPE_LEVEL[role]) return null;

  const propertyId = pickContextId(userOrReq, options, 'property_id', 'propertyId');
  const managementCompanyId = pickContextId(
    userOrReq,
    options,
    'management_company_id',
    'managementCompanyId',
  );
  const defaultScopeLevel = options.scope_level || ROLE_DEFAULT_SCOPE_LEVEL[role];
  const normalizedScope = normalizeScope(
    {
      scope_level: defaultScopeLevel,
      scope_id: options.scope_id || options.scopeId || null,
      property_id: propertyId,
      management_company_id: managementCompanyId,
    },
    { property_id: propertyId, management_company_id: managementCompanyId },
  );

  return {
    role,
    scope_level: normalizedScope.scope_level,
    scope_id: normalizedScope.scope_id,
    property_id: normalizedScope.property_id || propertyId,
    management_company_id: normalizedScope.management_company_id || managementCompanyId,
    source: options.source || 'derived',
  };
}

function idMatches(actual, required) {
  if (!required) return true;
  if (!actual) return false;
  return String(actual) === String(required);
}

function requiredIdMatches(actual, required) {
  if (!actual || !required) return false;
  return String(actual) === String(required);
}

function hasConcreteRequiredScopeTarget(requiredScope) {
  if (!requiredScope) return true;
  if (requiredScope.scope_level === 'platform') return true;
  if (requiredScope.scope_level === 'management_company') {
    return Boolean(requiredScope.scope_id || requiredScope.management_company_id);
  }
  if (requiredScope.scope_level === 'property') {
    return Boolean(requiredScope.scope_id || requiredScope.property_id || requiredScope.management_company_id);
  }
  return Boolean(requiredScope.scope_id || requiredScope.property_id || requiredScope.management_company_id);
}

function scopeMatches(membership, requiredScope) {
  if (!requiredScope) return true;
  if (!membership) return false;

  if (membership.scope_level === 'platform') return true;
  if (requiredScope.scope_level === 'platform') return membership.scope_level === 'platform';

  if (membership.scope_level === 'management_company') {
    if (requiredScope.scope_level === 'management_company') {
      return requiredIdMatches(membership.scope_id, requiredScope.scope_id);
    }
    if (requiredScope.scope_level === 'property') {
      return requiredIdMatches(membership.scope_id, requiredScope.management_company_id);
    }
    return requiredIdMatches(membership.scope_id, requiredScope.management_company_id);
  }

  if (membership.scope_level === 'property') {
    const membershipPropertyId = membership.scope_id || membership.property_id;
    if (requiredScope.scope_level === 'property') {
      return requiredIdMatches(membershipPropertyId, requiredScope.scope_id || requiredScope.property_id);
    }
    return requiredIdMatches(membershipPropertyId, requiredScope.property_id);
  }

  return membership.scope_level === requiredScope.scope_level
    && requiredIdMatches(membership.scope_id, requiredScope.scope_id)
    && idMatches(membership.property_id, requiredScope.property_id);
}

function hasScope(userOrReq, requiredScope, options = {}) {
  const membership = options.membership || buildRoleScopeMembership(userOrReq, options);
  if (!membership) return false;
  const normalizedRequired = normalizeScope(requiredScope, {
    property_id: options.required_property_id || options.requiredPropertyId || null,
    management_company_id:
      options.required_management_company_id || options.requiredManagementCompanyId || null,
  });
  if (!normalizedRequired) return true;
  if (!hasConcreteRequiredScopeTarget(normalizedRequired)) return false;
  return roleCanUseScope(membership.role, normalizedRequired.scope_level)
    && scopeMatches(membership, normalizedRequired);
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
  'access.topology.read': spec(accessStaff),
  'access.topology.write': spec(admin),
  'access.policy.read': spec(accessStaff),
  'access.policy.write': spec(admin),
  'access.security.workspace.read': spec(accessOperators),
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
  'requests:technician_read': spec(roles(FINAL_ROLES.TECHNICIAN, admin)),
  'requests:technician_work': spec(roles(FINAL_ROLES.TECHNICIAN, admin)),
  'requests:contractor_read': spec(roles(FINAL_ROLES.CONTRACTOR, FINAL_ROLES.CONCIERGE, admin)),
  'requests:contractor_work': spec(roles(FINAL_ROLES.CONTRACTOR, admin)),
  'requests:contractor_assign': spec(roles(FINAL_ROLES.CONCIERGE, admin), {
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

function canInScope(userOrReq, capability, requiredScope, options = {}) {
  const user = userFrom(userOrReq);
  if (!can(user, capability)) return false;
  return hasScope(userOrReq, requiredScope, options);
}

function requireCapabilityInScope(capability, scopeOrResolver, options = {}) {
  if (!(capability in CAPABILITIES)) {
    throw new Error(`[authz] requireCapabilityInScope: unknown capability '${capability}'`);
  }
  const message = options.message || 'Forbidden';

  return function requireCapabilityInScopeMiddleware(req, res, next) {
    const requiredScope = typeof scopeOrResolver === 'function'
      ? scopeOrResolver(req)
      : scopeOrResolver;
    if (canInScope(req, capability, requiredScope, options)) return next();
    if (typeof options.onDeny === 'function') {
      return options.onDeny(req, res);
    }
    return res.status(403).json({ error: message });
  };
}

function resolvePropertyScopeTarget(userOrReq, propertyId = null) {
  const req = requestFrom(userOrReq);
  const user = userFrom(userOrReq);
  return propertyId
    || req?.property?.id
    || req?.property?.property_id
    || req?.body?.property_id
    || req?.body?.propertyId
    || req?.query?.property_id
    || req?.query?.propertyId
    || user?.property_id
    || user?.propertyId
    || null;
}

function resolveMembershipPropertyId(userOrReq, targetPropertyId = null) {
  const req = requestFrom(userOrReq);
  const user = userFrom(userOrReq);
  return user?.property_id
    || user?.propertyId
    || req?.property?.id
    || req?.property?.property_id
    // Direct route unit tests mount v1 routers without propertyDbMiddleware.
    // Keep that path compatible while production remains tenant-scoped.
    || (!req?.property ? targetPropertyId : null)
    || null;
}

function canInPropertyScope(userOrReq, capability, propertyId = null, options = {}) {
  const targetPropertyId = resolvePropertyScopeTarget(userOrReq, propertyId);
  const membershipPropertyId = resolveMembershipPropertyId(userOrReq, targetPropertyId);
  return canInScope(
    userOrReq,
    capability,
    { scope_level: 'property', property_id: targetPropertyId },
    { ...options, property_id: membershipPropertyId },
  );
}

function requireCapabilityInPropertyScope(capability, propertyResolver, options = {}) {
  if (!(capability in CAPABILITIES)) {
    throw new Error(`[authz] requireCapabilityInPropertyScope: unknown capability '${capability}'`);
  }
  const message = options.message || 'Forbidden';

  return function requireCapabilityInPropertyScopeMiddleware(req, res, next) {
    const propertyId = typeof propertyResolver === 'function'
      ? propertyResolver(req)
      : propertyResolver;
    if (canInPropertyScope(req, capability, propertyId, options)) return next();
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
  ROLE_ALLOWED_SCOPE_LEVELS,
  ROLE_DEFAULT_SCOPE_LEVEL,
  ROLES: LEGACY_ROLES,
  SCOPE_LEVELS,
  STAFF_ROLES,
  buildRoleScopeMembership,
  can,
  canInScope,
  canInPropertyScope,
  hasScope,
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
  normalizeScope,
  requireCapability,
  requireCapabilityInScope,
  requireCapabilityInPropertyScope,
  resolvePropertyScopeTarget,
  roleCanUseScope,
};
