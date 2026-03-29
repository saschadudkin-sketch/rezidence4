'use strict';
/**
 * __tests__/constants.test.js
 * Покрывает: ROLES, STATUSES, STAFF_ROLES, RESIDENT_ROLES, isStaff, isResident
 */

const {
  ROLES, STATUSES,
  STAFF_ROLES, RESIDENT_ROLES,
  isStaff, isResident,
  normalizePhone,
} = require('../constants');

describe('ROLES', () => {
  const expected = ['owner', 'tenant', 'contractor', 'concierge', 'security', 'admin'];

  test.each(expected)('содержит роль "%s"', (role) => {
    expect(Object.values(ROLES)).toContain(role);
  });

  test('заморожен (Object.isFrozen)', () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
  });

  test('все значения уникальны', () => {
    const vals = Object.values(ROLES);
    expect(new Set(vals).size).toBe(vals.length);
  });

  test('OWNER = "owner"', () => expect(ROLES.OWNER).toBe('owner'));
  test('ADMIN = "admin"', () => expect(ROLES.ADMIN).toBe('admin'));
  test('SECURITY = "security"', () => expect(ROLES.SECURITY).toBe('security'));
  test('CONCIERGE = "concierge"', () => expect(ROLES.CONCIERGE).toBe('concierge'));
});

describe('STATUSES', () => {
  const expected = ['pending', 'approved', 'rejected', 'accepted', 'arrived', 'cancelled', 'scheduled', 'expired'];

  test.each(expected)('содержит статус "%s"', (status) => {
    expect(Object.values(STATUSES)).toContain(status);
  });

  test('заморожен', () => {
    expect(Object.isFrozen(STATUSES)).toBe(true);
  });

  test('все значения уникальны', () => {
    const vals = Object.values(STATUSES);
    expect(new Set(vals).size).toBe(vals.length);
  });

  test('PENDING = "pending"', () => expect(STATUSES.PENDING).toBe('pending'));
  test('APPROVED = "approved"', () => expect(STATUSES.APPROVED).toBe('approved'));
  test('CANCELLED = "cancelled"', () => expect(STATUSES.CANCELLED).toBe('cancelled'));
  test('EXPIRED = "expired"', () => expect(STATUSES.EXPIRED).toBe('expired'));
});

describe('STAFF_ROLES', () => {
  test('является Set', () => {
    expect(STAFF_ROLES).toBeInstanceOf(Set);
  });

  test.each(['security', 'concierge', 'admin'])('содержит "%s"', (role) => {
    expect(STAFF_ROLES.has(role)).toBe(true);
  });

  test.each(['owner', 'tenant', 'contractor'])('не содержит жильца "%s"', (role) => {
    expect(STAFF_ROLES.has(role)).toBe(false);
  });
});

describe('RESIDENT_ROLES', () => {
  test('является Set', () => {
    expect(RESIDENT_ROLES).toBeInstanceOf(Set);
  });

  test.each(['owner', 'tenant', 'contractor'])('содержит "%s"', (role) => {
    expect(RESIDENT_ROLES.has(role)).toBe(true);
  });

  test.each(['security', 'concierge', 'admin'])('не содержит персонал "%s"', (role) => {
    expect(RESIDENT_ROLES.has(role)).toBe(false);
  });
});

describe('STAFF_ROLES и RESIDENT_ROLES не пересекаются', () => {
  test('нет общих элементов', () => {
    const intersection = [...STAFF_ROLES].filter(r => RESIDENT_ROLES.has(r));
    expect(intersection).toHaveLength(0);
  });

  test('в сумме покрывают все 6 ролей', () => {
    const all = new Set([...STAFF_ROLES, ...RESIDENT_ROLES]);
    expect(all.size).toBe(Object.keys(ROLES).length);
  });
});

describe('isStaff(role)', () => {
  test.each(['security', 'concierge', 'admin'])('%s → true', (role) => {
    expect(isStaff(role)).toBe(true);
  });

  test.each(['owner', 'tenant', 'contractor'])('%s → false', (role) => {
    expect(isStaff(role)).toBe(false);
  });

  test('неизвестная роль → false', () => {
    expect(isStaff('superuser')).toBe(false);
    expect(isStaff(undefined)).toBe(false);
    expect(isStaff(null)).toBe(false);
    expect(isStaff('')).toBe(false);
  });
});

describe('isResident(role)', () => {
  test.each(['owner', 'tenant', 'contractor'])('%s → true', (role) => {
    expect(isResident(role)).toBe(true);
  });

  test.each(['security', 'concierge', 'admin'])('%s → false', (role) => {
    expect(isResident(role)).toBe(false);
  });

  test('неизвестная роль → false', () => {
    expect(isResident('superuser')).toBe(false);
    expect(isResident(undefined)).toBe(false);
    expect(isResident('')).toBe(false);
  });
});

// FIX [AUDIT-5]: normalizePhone — единая нормализация номеров телефонов
describe('normalizePhone(phone)', () => {
  test('10 цифр → +7 + цифры', () => {
    expect(normalizePhone('9161234567')).toBe('+79161234567');
  });

  test('11 цифр начиная с 7 → +7 + последние 10', () => {
    expect(normalizePhone('79161234567')).toBe('+79161234567');
  });

  test('11 цифр начиная с 8 → +7 + последние 10 (КРИТ: ранее давало +89xxx)', () => {
    expect(normalizePhone('89161234567')).toBe('+79161234567');
  });

  test('с разделителями: +7 (916) 123-45-67', () => {
    expect(normalizePhone('+7 (916) 123-45-67')).toBe('+79161234567');
  });

  test('уже нормализованный +79161234567 → без изменений', () => {
    expect(normalizePhone('+79161234567')).toBe('+79161234567');
  });

  test('международный 12+ цифр → + + все цифры', () => {
    expect(normalizePhone('+442071234567')).toBe('+442071234567');
  });

  test('пустая строка → "+"', () => {
    expect(normalizePhone('')).toBe('+');
  });
});
