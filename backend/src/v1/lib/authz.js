'use strict';

// platform-v1 authorization library — capability-model поверх existing role claims.
// Spec: auth-v1-spec.md §2 (shape JWT claims с capabilities) + ROADMAP Phase 6
// («перенос perms в v1 с capability-моделью»).
//
// Зачем:
//   До этого модуля каждый из 14 v1/routes/*.js имел локальные copy-paste
//   предикаты:
//
//     function isAdmin(req) { return req.user && req.user.role === 'admin'; }
//     function isStaffOrAdmin(req) { return req.user && (isStaff(req.user.role) || req.user.role === 'admin'); }
//     function isSecurity(req) { return req.user && (req.user.role === 'security' || req.user.role === 'admin'); }
//     function isResident(req) { return req.user && req.user.role === 'resident'; }
//     ...
//
//   Это было 83 occurrences role-проверок в v1.  При добавлении новой роли
//   (например, `guest_admin` или `uk_operator`) пришлось бы обойти все 14
//   файлов.  Плюс — нигде не использовались per-staff capability-флаги
//   (`can_view_resident_phone`, `can_assign_requests` из staff_users),
//   хотя миграция 005 их ввела.
//
// После:
//   * Один catalog CAPABILITIES — единый source of truth
//   * can(user, 'outbox:read') — предикат
//   * requireCapability('outbox:read') — middleware-фабрика
//   * Role предикаты (isStaff/isResident/isSecurity/...) — re-export
//     из constants.js для удобства роутов, которые ещё не мигрировали
//     на can().
//
// Admin bypass:
//   role === 'admin' автоматически имеет все capability'и.  Это matches
//   поведение legacy isAdmin/isPropertyAdmin (они выдавали 'admin' как
//   super-role).  Когда Phase 7 приносит реальный property_admin из
//   staff_users, это admin bypass останется тем же — просто subject_type
//   будет 'staff', а role — 'property_admin' (и mapping в capabilities
//   всё равно короткозамкнётся через проверку role).

const { ROLES, STAFF_ROLES, RESIDENT_ROLES, isStaff, isResident } = require('../../constants');

// ─── CAPABILITIES catalog ────────────────────────────────────────────────────
//
// Форма:
//   'resource:action': {
//     roles?: ['security', 'concierge'],       // whitelist ролей (admin всегда bypass)
//     staffFlag?: 'can_view_resident_phone',   // boolean field из req.user
//                                                 (staff_users.capabilities)
//   }
//
// Отсутствие обоих ключей = только admin.  Это consistent с «admin-only»
// семантикой текущих isAdmin-проверок.
//
// NB: расширять catalog — централизованно в этом файле.  Если route вводит
// новую capability, он ДОБАВЛЯЕТ сюда, а не создаёт свой локальный помощник.

const CAPABILITIES = Object.freeze({
  // ─── Outbox admin UI (adminOutbox.js) ──────────────────────────────────────
  // Все operations — admin only.  Подложной observability — Prometheus
  // scrape через service account → admin token.
  'outbox:read':                 { roles: [] },  // admin only
  'outbox:requeue':              { roles: [] },
  'outbox:cancel':               { roles: [] },

  // ─── Announcements (announcements.js) ──────────────────────────────────────
  'announcements:read':          { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },  // staff + resident (resident отдельно через isResident + visibility)
  'announcements:publish':       { roles: [] },  // admin
  'announcements:archive':       { roles: [] },
  'announcements:unpublish_urgent': { roles: [] }, // urgent announcements — admin-only unpublish

  // ─── Documents (documents.js) ──────────────────────────────────────────────
  'documents:read':              { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'documents:publish':           { roles: [] },
  'documents:archive':           { roles: [] },
  'documents:delete':            { roles: [] },

  // ─── Packages (packages.js) ────────────────────────────────────────────────
  'packages:read':               { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'packages:manage':             { roles: [] },

  // ─── Notification log (notificationLog.js) ─────────────────────────────────
  'notification-log:read':       { roles: [] },  // admin

  // ─── Residents (residents.js) ──────────────────────────────────────────────
  'residents:read':              { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'residents:write':             { roles: [] },  // admin only
  'residents:read_phone':        {
    roles: [ROLES.CONCIERGE],           // concierge видит phone по умолчанию
    staffFlag: 'can_view_resident_phone', // + любой staff с explicit флагом
  },

  // ─── Access requests (accessRequests.js) ───────────────────────────────────
  'requests:read':               { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'requests:write':              { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'requests:approve':            { roles: [] },
  'requests:escalate':           { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'requests:assign':             {
    roles: [ROLES.CONCIERGE],
    staffFlag: 'can_assign_requests',
  },

  // ─── Passes (passes.js) ────────────────────────────────────────────────────
  'passes:read':                 { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'passes:manage':               { roles: [] },
  'passes:block':                { roles: [ROLES.SECURITY] },  // security OR admin

  // ─── Visits (visits.js) ────────────────────────────────────────────────────
  'visits:verify':               { roles: [ROLES.SECURITY] },  // security OR admin
  'visits:read':                 { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },

  // ─── Access incidents (accessIncidents.js) ─────────────────────────────────
  'incidents:read':              { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'incidents:write':             { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'incidents:override':          { roles: [] },  // override — admin only

  // ─── Staff (staff.js) ──────────────────────────────────────────────────────
  'staff:read':                  { roles: [] },  // admin
  'staff:write':                 { roles: [] },

  // ─── Contractors (contractors.js) ──────────────────────────────────────────
  'contractors:read':            { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'contractors:write':           { roles: [] },

  // ─── Structure (structure.js) — buildings/entrances/units ──────────────────
  'structure:read':              { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'structure:write':             { roles: [] },

  // ─── Vehicles (vehicles.js) ────────────────────────────────────────────────
  'vehicles:read':               { roles: [ROLES.SECURITY, ROLES.CONCIERGE] },
  'vehicles:manage':             { roles: [] },
});

// ─── can(user, capability) ───────────────────────────────────────────────────

/**
 * can — resolves whether `user` has the given capability.
 *
 *   user         — { role, [staffFlag]... } — обычно req.user из middleware/auth.
 *   capability   — строка из CAPABILITIES ключей; при опечатке throws.
 *
 * Семантика:
 *   1. !user → false (not authenticated)
 *   2. user.role === 'admin' → true (super-role bypass, legacy-compat)
 *   3. capability spec.roles includes user.role → true
 *   4. capability spec.staffFlag + user[staffFlag] === true → true
 *   5. Иначе false
 */
function can(user, capability) {
  if (!user) return false;
  if (user.role === ROLES.ADMIN) return true;

  const spec = CAPABILITIES[capability];
  if (!spec) {
    // Throw, not silent-false: опечатка в capability имени должна шумно
    // падать в dev/test, а не скрытно deny'ить всем.
    throw new Error(`[authz] unknown capability: '${capability}'. Add to CAPABILITIES catalog.`);
  }

  if (Array.isArray(spec.roles) && spec.roles.includes(user.role)) return true;
  if (spec.staffFlag && user[spec.staffFlag] === true) return true;

  return false;
}

// ─── requireCapability(capability) — middleware factory ──────────────────────

/**
 * requireCapability — Express middleware, который пропускает запрос, если
 * can(req.user, capability) === true; иначе 403.
 *
 * Usage:
 *   const { requireCapability } = require('../lib/authz');
 *   router.get('/metrics', requireCapability('outbox:read'), handler);
 *
 * Options:
 *   - message:  пользовательский error-текст (default: 'Forbidden')
 *   - onDeny:   callback (req, res) — для custom audit/logging, must END response
 *
 * Если `onDeny` передан, middleware НЕ пишет res.status — делегирует ответ
 * callback'у.  Полезно, если нужно вернуть 404 вместо 403 для leakage-sensitive
 * ручек.
 */
function requireCapability(capability, options = {}) {
  // Validate capability at boot time (not at request time) — catches typos
  // сразу, когда router монтируется, а не когда пользователь делает запрос.
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

// ─── Role предикаты — re-export + унифицированные формы ──────────────────────
//
// Эти helpers используются тем кодом, который ещё не мигрировал на can().
// После миграции большинство call-sites перейдут на can(user, 'resource:action').
// Но некоторые места (например, "resident видит только свои requests vs staff
// видит все") — это NOT capability, это filter.  Там роль-предикат ok.
//
// isStaff/isResident — re-export из constants.js как есть (Set-based matching).
// isAdmin — унифицированная форма, принимает как (req) так и (user).

function isAdmin(userOrReq) {
  if (!userOrReq) return false;
  // Accept both req (with .user) and user directly — legacy call-sites
  // передают req, а новые can()-вызовы — user напрямую.
  const u = userOrReq.user || userOrReq;
  return u && u.role === ROLES.ADMIN;
}

function isSecurity(userOrReq) {
  if (!userOrReq) return false;
  const u = userOrReq.user || userOrReq;
  return u && (u.role === ROLES.SECURITY || u.role === ROLES.ADMIN);
}

function isStaffOrAdmin(userOrReq) {
  if (!userOrReq) return false;
  const u = userOrReq.user || userOrReq;
  if (!u) return false;
  return isStaff(u.role) || u.role === ROLES.ADMIN;
}

function isResidentUser(userOrReq) {
  if (!userOrReq) return false;
  const u = userOrReq.user || userOrReq;
  // NB: v1 роуты исторически проверяют строку 'resident' (это будущий
  // claim из v1-JWT, см. auth-v1-spec.md §2).  Legacy-constants isResident
  // (из constants.js) проверяет Set {owner, tenant, contractor} — для
  // legacy JWT.  Здесь следуем шаблону v1 routes, чтобы refactor был
  // behavior-preserving.
  return !!u && u.role === 'resident';
}

// ─── Debug helper: listAllCapabilities ───────────────────────────────────────

/**
 * listAllCapabilities — для админ-UI или security-аудита.  Возвращает
 * копию catalog'а как object (Object.freeze защищает от mutations).
 */
function listAllCapabilities() {
  return { ...CAPABILITIES };
}

module.exports = {
  can,
  requireCapability,
  // Role предикаты (accept req или user)
  isAdmin,
  isSecurity,
  isStaffOrAdmin,
  isResidentUser,
  // Re-export из constants (для роутов, которые ещё не мигрировали)
  isStaff,
  isResident,
  // Re-export constants (имена ролей — не magic strings)
  ROLES,
  STAFF_ROLES,
  RESIDENT_ROLES,
  // Introspection
  listAllCapabilities,
  CAPABILITIES,
};
