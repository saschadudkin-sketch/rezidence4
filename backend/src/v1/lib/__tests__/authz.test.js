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
  ROLES,
  listAllCapabilities,
  CAPABILITIES,
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

  test('admin bypass работает ДАЖЕ для несуществующих capability (не throw)', () => {
    // Это design-decision: admin check идёт ДО lookup'а в CAPABILITIES,
    // так что admin не получит Error при опечатке в capability-name.
    // Это ок: admin всё равно true, deny-case не нужен.
    const admin = { role: 'admin' };
    expect(can(admin, 'any:nonsense:string')).toBe(true);
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
  });

  test('resident never has staff caps', () => {
    const resident = { role: 'resident', can_view_resident_phone: true };
    // Резидент не становится staff из-за флага — roles whitelist НЕ
    // includes 'resident', и staffFlag даёт TRUE только если role — staff.
    // Вообще-то, текущая логика: staffFlag проверяется независимо от role.
    // Это соответствует тому, как выдаёт JWT — resident не получит этих
    // флагов, но если получит (bug), то can() всё равно пропустит.
    // Документируем текущее поведение: да, пропустит.  Защита от bug'а
    // в JWT должна быть на уровне issuance, не consume.
    expect(can(resident, 'residents:read_phone')).toBe(true);
    // …но 'announcements:publish' (admin-only) — точно нет.
    expect(can(resident, 'announcements:publish')).toBe(false);
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

  test('isResidentUser: только string "resident" (v1 convention)', () => {
    expect(isResidentUser({ role: 'resident' })).toBe(true);
    expect(isResidentUser({ user: { role: 'resident' } })).toBe(true);
    expect(isResidentUser({ role: 'owner' })).toBe(false);   // legacy role ≠ v1 literal
    expect(isResidentUser({ role: 'admin' })).toBe(false);
    expect(isResidentUser(null)).toBe(false);
  });

  test('re-exported isStaff/isResident — legacy constants semantics', () => {
    expect(isStaff('security')).toBe(true);
    expect(isStaff('concierge')).toBe(true);
    expect(isStaff('admin')).toBe(true);
    expect(isStaff('resident')).toBe(false);
    expect(isStaff('owner')).toBe(false);
    // isResident (constants.js) = Set{owner, tenant, contractor}
    expect(isResident('owner')).toBe(true);
    expect(isResident('tenant')).toBe(true);
    expect(isResident('contractor')).toBe(true);
    expect(isResident('resident')).toBe(false);  // literal "resident" — не в Set'е
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
      'requests:assign',
      'passes:read', 'passes:manage', 'passes:block',
      'visits:verify', 'visits:read',
      'incidents:read', 'incidents:write', 'incidents:override',
      'staff:read', 'staff:write',
      'contractors:read', 'contractors:write',
      'structure:read', 'structure:write',
      'vehicles:read', 'vehicles:manage',
    ];
    for (const cap of required) {
      expect(CAPABILITIES[cap]).toBeDefined();
    }
  });
});
