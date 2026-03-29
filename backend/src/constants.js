'use strict';
/**
 * constants.js — FIX [CODE-1]: централизованные enum-константы.
 * Устраняет магические строки ролей/статусов по всему коду.
 * Использование: const { ROLES, STATUSES } = require('./constants');
 */

const ROLES = Object.freeze({
  OWNER:      'owner',
  TENANT:     'tenant',
  CONTRACTOR: 'contractor',
  CONCIERGE:  'concierge',
  SECURITY:   'security',
  ADMIN:      'admin',
});

const STATUSES = Object.freeze({
  PENDING:   'pending',
  APPROVED:  'approved',
  REJECTED:  'rejected',
  ACCEPTED:  'accepted',
  ARRIVED:   'arrived',
  CANCELLED: 'cancelled',
  SCHEDULED: 'scheduled',
  EXPIRED:   'expired',
});

// Роли персонала, которые могут управлять заявками
const STAFF_ROLES = new Set([ROLES.SECURITY, ROLES.CONCIERGE, ROLES.ADMIN]);

// Роли жильцов — могут создавать заявки, видят только свои
const RESIDENT_ROLES = new Set([ROLES.OWNER, ROLES.TENANT, ROLES.CONTRACTOR]);

function isStaff(role)    { return STAFF_ROLES.has(role); }
function isResident(role) { return RESIDENT_ROLES.has(role); }

/**
 * normalizePhone — единая нормализация номера телефона.
 * FIX [AUDIT-5 #4]: ранее дублировалась в auth.js и users.js с РАЗНОЙ логикой.
 * auth.js: 89161234567 → +79161234567 (правильно, убирает 8)
 * users.js: 89161234567 → +89161234567 (НЕПРАВИЛЬНО, не убирает 8)
 * Пользователь, созданный админом, не мог войти если номер начинался с 8.
 */
function normalizePhone(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) return '+7' + digits;
  return '+' + digits;
}

module.exports = { ROLES, STATUSES, STAFF_ROLES, RESIDENT_ROLES, isStaff, isResident, normalizePhone };
