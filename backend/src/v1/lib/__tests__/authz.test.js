'use strict';

// Unit-тесты для backend/src/v1/lib/authz.js — capability-model library.
// Это чистая функциональная логика (никаких БД/сети), так что все кейсы
// — synchronous, быстрые.

const {
  can,
  requireCapability,
  isAdmin,
  isSecurity,
  isStaffOrAdmin,
  isResidentUser,
  isStaff,
  isResident,
  FINAL_ROLES,
  LEGACY_ROLE_TO_FINAL_ROLE,
  ROLES,
  ROLE_CAPABILITIES,
  SCOPE_LEVELS,
  ROLE_ALLOWED_SCOPE_LEVELS,
  buildRoleScopeMembership,
  canInPropertyScope,
  canInScope,
  hasScope,
  listAllCapabilities,
  CAPABILITIES,
  isKnownScopeLevel,
  normalizeRole,
  normalizeScope,
  requireCapabilityInScope,
  requireCapabilityInPropertyScope,
  resolvePropertyScopeTarget,
  roleCanUseScope,
} = require('../authz');

// ──────────────────────────────────────────────────────────────────────────
// can() — core predicate
// ──────────────────────────────────────────────────────────────────────────

describe('can(user, capability)', () => {
  test('returns false if user is null/undefined', () => {
    expect(can(null, 'outbox:read')).toBe(false);
    expect(can(undefined, 'outbox:read')).toBe(false);
  });

  test('admin is super-role: any capability returns true', () => {
    const admin = { role: 'admin' };
    // Проверяем разнообразные capability'и, включая staff-flag based.
    expect(can(admin, 'outbox:read')).toBe(true);
    expect(can(admin, 'announcements:publish')).toBe(true);
    expect(can(admin, 'residents:read_phone')).toBe(true);
    expect(can(admin, 'visits:verify')).toBe(true);
    expect(can(admin, 'incidents:override')).toBe(true);
  });

  test('unknown capability throws for admin too', () => {
    const admin = { role: 'admin' };
    expect(() => can(admin, 'any:nonsense:string')).toThrow(/unknown capability/i);
  });

  test('throws on unknown capability для не-admin user', () => {
    const staff = { role: 'concierge' };
    expect(() => can(staff, 'completely:made:up')).toThrow(/unknown capability/i);
    expect(() => can(staff, '')).toThrow();
  });

  test('role-whitelist: concierge имеет announcements:read но не publish', () => {
    const concierge = { role: 'concierge' };
    expect(can(concierge, 'announcements:read')).toBe(true);
    expect(can(concierge, 'announcements:publish')).toBe(false);
  });

  test('role-whitelist: security имеет visits:verify но не publish', () => {
    const security = { role: 'security' };
    expect(can(security, 'visits:verify')).toBe(true);
    expect(can(security, 'announcements:publish')).toBe(false);
    expect(can(security, 'incidents:override')).toBe(false);
  });

  test('admin-only capability: resident/staff deny', () => {
    expect(can({ role: 'resident' }, 'outbox:read')).toBe(false);
    expect(can({ role: 'security' }, 'outbox:read')).toBe(false);
    expect(can({ role: 'concierge' }, 'outbox:read')).toBe(false);
    expect(can({ role: 'admin' }, 'outbox:read')).toBe(true);
  });

  test('staffFlag: concierge с can_view_resident_phone=true → allowed', () => {
    // concierge по умолчанию (via roles whitelist) имеет residents:read_phone
    expect(can({ role: 'concierge' }, 'residents:read_phone')).toBe(true);
    // Но security — нет, unless флаг true.
    expect(can({ role: 'security' }, 'residents:read_phone')).toBe(false);
    expect(can(
      { role: 'security', can_view_resident_phone: true },
      'residents:read_phone',
    )).toBe(true);
  });

  test('staffFlag: technician без флага deny, с флагом allow', () => {
    // technician не в roles whitelist (там concierge), но staffFlag
    // can_view_resident_phone работает независимо от роли.
    expect(can({ role: 'technician' }, 'residents:read_phone')).toBe(false);
    expect(can(
      { role: 'technician', can_view_resident_phone: true },
      'residents:read_phone',
    )).toBe(true);
  });

  test('staffFlag: false/null/missing → deny', () => {
    // Флаг должен быть ТОЧНО === true.  null, undefined, 'yes', 1 —
    // всё не считается.
    expect(can({ role: 'technician' }, 'residents:read_phone')).toBe(false);
    expect(can({ role: 'technician', can_view_resident_phone: false }, 'residents:read_phone')).toBe(false);
    expect(can({ role: 'technician', can_view_resident_phone: null }, 'residents:read_phone')).toBe(false);
    expect(can({ role: 'technician', can_view_resident_phone: 'true' }, 'residents:read_phone')).toBe(false);
    expect(can({ role: 'technician', can_view_resident_phone: 1 }, 'residents:read_phone')).toBe(false);
  });

  test('staffFlag: can_assign_requests works the same', () => {
    expect(can({ role: 'security', can_assign_requests: true }, 'requests:assign')).toBe(true);
    expect(can({ role: 'security' }, 'requests:assign')).toBe(false);
    expect(can({ role: 'concierge' }, 'requests:assign')).toBe(true); // via roles
    expect(can({ role: 'security', can_assign_requests: true }, 'requests:contractor_assign')).toBe(true);
    expect(can({ role: 'security' }, 'requests:contractor_assign')).toBe(false);
  });

  test('contractor workflow capabilities stay role-scoped', () => {
    expect(can({ role: 'contractor' }, 'requests:contractor_read')).toBe(true);
    expect(can({ role: 'contractor' }, 'requests:contractor_work')).toBe(true);
    expect(can({ role: 'contractor' }, 'requests:contractor_assign')).toBe(false);
    expect(can({ role: 'concierge' }, 'requests:contractor_read')).toBe(true);
    expect(can({ role: 'concierge' }, 'requests:contractor_work')).toBe(false);
    expect(can({ role: 'technician' }, 'requests:contractor_read')).toBe(false);
  });

  test('resident never gets staff caps from leaked staff flags', () => {
    const resident = { role: 'resident', can_view_resident_phone: true };
    expect(can(resident, 'residents:read_phone')).toBe(false);
    expect(can(resident, 'announcements:publish')).toBe(false);
  });

  test('Phase 3 access capability catalog is explicit by final role', () => {
    expect(can({ role: 'owner' }, 'access.request.create')).toBe(true);
    expect(can({ role: 'tenant' }, 'access.request.create')).toBe(true);
    expect(can({ role: 'contractor' }, 'access.request.create')).toBe(true);
    expect(can({ role: 'security' }, 'access.qr.verify')).toBe(true);
    expect(can({ role: 'concierge' }, 'access.qr.verify')).toBe(false);
    expect(can({ role: 'admin' }, 'access.request.approve')).toBe(true);
    expect(can({ role: 'property_admin' }, 'audit.read')).toBe(true);
    expect(can({ role: 'management_company_admin' }, 'access.pass.revoke')).toBe(true);
    expect(can({ role: 'platform_admin' }, 'access.override.create')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// requireCapability middleware
// ──────────────────────────────────────────────────────────────────────────

describe('requireCapability(cap)', () => {
  function fakeRes() {
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      end: jest.fn().mockReturnThis(),
    };
    return res;
  }

  test('throws at factory-time для unknown capability (fail-fast)', () => {
    expect(() => requireCapability('bogus:op')).toThrow(/unknown capability/);
  });

  test('calls next() if can() allows', () => {
    const mw = requireCapability('announcements:publish');
    const req = { user: { role: 'admin' } };
    const res = fakeRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 403 if can() denies', () => {
    const mw = requireCapability('announcements:publish');
    const req = { user: { role: 'resident' } };
    const res = fakeRes();
    const next = jest.fn();
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  test('custom message option', () => {
    const mw = requireCapability('outbox:read', { message: 'Admin only' });
    const res = fakeRes();
    mw({ user: { role: 'resident' } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin only' });
  });

  test('onDeny callback overrides response', () => {
    const onDeny = jest.fn((req, res) => res.status(404).end());
    const mw = requireCapability('outbox:read', { onDeny });
    const req = { user: { role: 'resident' } };
    const res = fakeRes();
    mw(req, res, jest.fn());
    expect(onDeny).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    // json() не вызван — onDeny был responsible за response.
    expect(res.json).not.toHaveBeenCalled();
  });

  test('req без user → 403 (auth middleware должен стоять раньше)', () => {
    const mw = requireCapability('outbox:read');
    const res = fakeRes();
    mw({}, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Role предикаты — accept req OR user
// ──────────────────────────────────────────────────────────────────────────

describe('Role predicates — req/user duality', () => {
  test('isAdmin принимает req или user', () => {
    expect(isAdmin({ role: 'admin' })).toBe(true);            // user-like
    expect(isAdmin({ user: { role: 'admin' } })).toBe(true);  // req-like
    expect(isAdmin({ role: 'concierge' })).toBe(false);
    expect(isAdmin({ user: { role: 'concierge' } })).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
    expect(isAdmin({})).toBe(false);
  });

  test('isSecurity: security И admin — true', () => {
    expect(isSecurity({ role: 'security' })).toBe(true);
    expect(isSecurity({ role: 'admin' })).toBe(true);
    expect(isSecurity({ role: 'concierge' })).toBe(false);
    expect(isSecurity({ role: 'resident' })).toBe(false);
    expect(isSecurity(null)).toBe(false);
  });

  test('isStaffOrAdmin: staff roles + admin = true', () => {
    expect(isStaffOrAdmin({ role: 'security' })).toBe(true);
    expect(isStaffOrAdmin({ role: 'concierge' })).toBe(true);
    expect(isStaffOrAdmin({ role: 'admin' })).toBe(true);
    expect(isStaffOrAdmin({ role: 'resident' })).toBe(false);
    expect(isStaffOrAdmin({ role: 'owner' })).toBe(false);  // owner — resident-level в legacy
  });

  test('isResidentUser: final resident plus legacy owner/tenant mapping', () => {
    expect(isResidentUser({ role: 'resident' })).toBe(true);
    expect(isResidentUser({ user: { role: 'resident' } })).toBe(true);
    expect(isResidentUser({ role: 'owner' })).toBe(true);
    expect(isResidentUser({ role: 'tenant' })).toBe(true);
    expect(isResidentUser({ role: 'admin' })).toBe(false);
    expect(isResidentUser({ role: 'contractor' })).toBe(false);
    expect(isResidentUser(null)).toBe(false);
  });

  test('role predicates use Phase 3 compatibility mapping', () => {
    expect(isStaff('security')).toBe(true);
    expect(isStaff('concierge')).toBe(true);
    expect(isStaff('technician')).toBe(true);
    expect(isStaff('property_admin')).toBe(true);
    expect(isStaff('admin')).toBe(true);
    expect(isStaff('resident')).toBe(false);
    expect(isStaff('owner')).toBe(false);
    expect(isResident('owner')).toBe(true);
    expect(isResident('tenant')).toBe(true);
    expect(isResident('contractor')).toBe(false);
    expect(isResident('resident')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// listAllCapabilities / CAPABILITIES introspection
// ──────────────────────────────────────────────────────────────────────────

describe('Catalog introspection', () => {
  test('listAllCapabilities возвращает копию catalog\'а', () => {
    const all = listAllCapabilities();
    expect(typeof all).toBe('object');
    expect(all['outbox:read']).toBeDefined();
    expect(all['announcements:publish']).toBeDefined();
  });

  test('CAPABILITIES — frozen', () => {
    // Object.freeze: попытка mutation не бросает в non-strict, но не меняет.
    // В strict-mode файла — throws.
    expect(Object.isFrozen(CAPABILITIES)).toBe(true);
  });

  test('catalog имеет обязательные капабилити для всех route resource\'ов', () => {
    // Sanity: если кто-то удалит capability, сломается этот тест + 14 route
    // файлов.
    const required = [
      'outbox:read', 'outbox:requeue', 'outbox:cancel',
      'announcements:read', 'announcements:publish', 'announcements:archive',
      'announcements:unpublish_urgent',
      'documents:read', 'documents:publish', 'documents:archive', 'documents:delete',
      'packages:read', 'packages:manage',
      'notification-log:read',
      'residents:read', 'residents:write', 'residents:read_phone',
      'requests:read', 'requests:write', 'requests:approve', 'requests:escalate',
      'requests:assign', 'requests:technician_read', 'requests:technician_work',
      'requests:contractor_read', 'requests:contractor_work', 'requests:contractor_assign',
      'passes:read', 'passes:manage', 'passes:block',
      'visits:verify', 'visits:read',
      'incidents:read', 'incidents:write', 'incidents:override',
      'staff:read', 'staff:write',
      'contractors:read', 'contractors:write',
      'structure:read', 'structure:write',
      'vehicles:read', 'vehicles:manage',
      'access.request.create', 'access.request.approve', 'access.request.reject',
      'access.pass.read', 'access.pass.revoke', 'access.pass.block',
      'access.qr.verify', 'access.plate.verify',
      'access.incident.create', 'access.incident.resolve',
      'access.override.create', 'access.topology.read',
      'access.topology.write', 'access.policy.read', 'access.policy.write',
      'access.security.workspace.read', 'audit.read', 'portfolio.dashboard.read',
    ];
    for (const cap of required) {
      expect(CAPABILITIES[cap]).toBeDefined();
    }
  });

  test('final role and scope catalogs expose Phase 3 source of truth', () => {
    expect(Object.values(FINAL_ROLES)).toEqual(expect.arrayContaining([
      'resident',
      'security',
      'concierge',
      'technician',
      'contractor',
      'property_admin',
      'management_company_admin',
      'platform_admin',
    ]));
    expect(LEGACY_ROLE_TO_FINAL_ROLE[ROLES.OWNER]).toBe(FINAL_ROLES.RESIDENT);
    expect(LEGACY_ROLE_TO_FINAL_ROLE[ROLES.ADMIN]).toBe(FINAL_ROLES.PROPERTY_ADMIN);
    expect(normalizeRole('tenant')).toBe(FINAL_ROLES.RESIDENT);
    expect(SCOPE_LEVELS).toEqual(expect.arrayContaining([
      'platform', 'management_company', 'property', 'building', 'entrance', 'floor', 'unit',
      'parking_zone', 'access_zone', 'access_point',
    ]));
    expect(isKnownScopeLevel('access_point')).toBe(true);
    expect(isKnownScopeLevel('portfolio')).toBe(false);
  });

  test('every final role has an explicit capability entry', () => {
    for (const role of Object.values(FINAL_ROLES)) {
      expect(Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, role)).toBe(true);
      expect(Array.isArray(ROLE_CAPABILITIES[role])).toBe(true);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// DH-03 role/scope membership primitives
// ──────────────────────────────────────────────────────────────────────────

describe('Role/scope membership primitives', () => {
  test('normalizeScope validates known levels and resolves context ids', () => {
    expect(normalizeScope('platform')).toEqual({
      scope_level: 'platform',
      scope_id: null,
      property_id: null,
      management_company_id: null,
    });
    expect(normalizeScope({ scope_level: 'property' }, { property_id: 'p1' })).toMatchObject({
      scope_level: 'property',
      scope_id: 'p1',
      property_id: 'p1',
    });
    expect(() => normalizeScope('portfolio')).toThrow(/unknown scope level/);
  });

  test('buildRoleScopeMembership maps final and legacy roles to default scopes', () => {
    expect(buildRoleScopeMembership({ role: 'platform_admin' })).toMatchObject({
      role: 'platform_admin',
      scope_level: 'platform',
      scope_id: null,
    });
    expect(buildRoleScopeMembership({
      role: 'management_company_admin',
      management_company_id: 'mc1',
    })).toMatchObject({
      role: 'management_company_admin',
      scope_level: 'management_company',
      scope_id: 'mc1',
    });
    expect(buildRoleScopeMembership({ role: 'admin', property_id: 'p1' })).toMatchObject({
      role: 'property_admin',
      scope_level: 'property',
      scope_id: 'p1',
    });
    expect(buildRoleScopeMembership({ user: { role: 'owner', property_id: 'p1' } })).toMatchObject({
      role: 'resident',
      scope_level: 'property',
      scope_id: 'p1',
    });
  });

  test('roleCanUseScope follows final role boundaries', () => {
    expect(roleCanUseScope('platform_admin', 'platform')).toBe(true);
    expect(roleCanUseScope('platform_admin', 'access_point')).toBe(true);
    expect(roleCanUseScope('management_company_admin', 'management_company')).toBe(true);
    expect(roleCanUseScope('management_company_admin', 'platform')).toBe(false);
    expect(roleCanUseScope('security', 'access_point')).toBe(true);
    expect(roleCanUseScope('security', 'unit')).toBe(false);
    expect(Object.isFrozen(ROLE_ALLOWED_SCOPE_LEVELS.property_admin)).toBe(true);
  });

  test('hasScope denies cross-property access for property admins', () => {
    const adminReq = { user: { role: 'admin', property_id: 'p1' } };
    expect(hasScope(adminReq, { scope_level: 'property', property_id: 'p1' })).toBe(true);
    expect(hasScope(adminReq, { scope_level: 'property', property_id: 'p2' })).toBe(false);
    expect(hasScope(adminReq, { scope_level: 'property' })).toBe(false);
  });

  test('management company scope can cover a property only when MC id is known', () => {
    const mcAdmin = { role: 'management_company_admin', management_company_id: 'mc1' };
    expect(hasScope(mcAdmin, {
      scope_level: 'property',
      property_id: 'p1',
      management_company_id: 'mc1',
    })).toBe(true);
    expect(hasScope(mcAdmin, {
      scope_level: 'property',
      property_id: 'p2',
      management_company_id: 'mc2',
    })).toBe(false);
    expect(hasScope(mcAdmin, { scope_level: 'property', property_id: 'p3' })).toBe(false);
  });

  test('canInScope combines capability and scope checks', () => {
    expect(canInScope(
      { role: 'admin', property_id: 'p1' },
      'staff:write',
      { scope_level: 'property', property_id: 'p1' },
    )).toBe(true);
    expect(canInScope(
      { role: 'admin', property_id: 'p1' },
      'staff:write',
      { scope_level: 'property', property_id: 'p2' },
    )).toBe(false);
    expect(canInScope(
      { role: 'platform_admin' },
      'staff:write',
      { scope_level: 'property', property_id: 'p-any' },
    )).toBe(true);
    expect(canInScope(
      { role: 'resident', property_id: 'p1' },
      'staff:write',
      { scope_level: 'property', property_id: 'p1' },
    )).toBe(false);
  });

  test('canInPropertyScope resolves tenant property and denies cross-property tokens', () => {
    expect(canInPropertyScope(
      { user: { role: 'admin' }, property: { id: 'p1' } },
      'staff:write',
      'p1',
    )).toBe(true);
    expect(canInPropertyScope(
      { user: { role: 'admin', property_id: 'p2' }, property: { id: 'p1' } },
      'staff:write',
      'p1',
    )).toBe(false);
    expect(canInPropertyScope(
      { user: { role: 'admin' } },
      'staff:write',
      'p1',
    )).toBe(true);
  });

  test('resolvePropertyScopeTarget prefers explicit and tenant property ids', () => {
    expect(resolvePropertyScopeTarget(
      { user: { property_id: 'user-p' }, property: { id: 'tenant-p' } },
      'explicit-p',
    )).toBe('explicit-p');
    expect(resolvePropertyScopeTarget(
      { user: { property_id: 'user-p' }, property: { id: 'tenant-p' } },
    )).toBe('tenant-p');
    expect(resolvePropertyScopeTarget({ user: { property_id: 'user-p' } })).toBe('user-p');
  });

  test('requireCapabilityInScope returns 403 on scope mismatch', () => {
    const mw = requireCapabilityInScope(
      'staff:write',
      (req) => ({ scope_level: 'property', property_id: req.params.propertyId }),
    );
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    mw({ user: { role: 'admin', property_id: 'p1' }, params: { propertyId: 'p2' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  test('requireCapabilityInPropertyScope returns 403 on property mismatch', () => {
    const mw = requireCapabilityInPropertyScope('staff:write', (req) => req.params.propertyId);
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    const next = jest.fn();

    mw({ user: { role: 'admin', property_id: 'p1' }, params: { propertyId: 'p2' } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });
});
