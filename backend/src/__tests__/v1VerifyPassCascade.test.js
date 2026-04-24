'use strict';

/**
 * Phase 3 — verify-pass cascade unit tests.
 * Spec: docs/product/specs/platform-v1/qr-verification-spec.md §3, §6.
 *
 * Pure-logic тесты на каскад verdict'ов.  БД не нужна — тестируем
 * computeVerdict, а не verifyPass orchestration.  Это фиксирует
 * ожидаемое поведение каждой ветки cascade'а и не даёт случайно
 * нарушить приоритет причин отказа.
 */

const { describe, test, expect } = require('@jest/globals');
const { computeVerdict, ONE_SHOT_PASS_TYPES } = require('../v1/services/verifyPass');

// Минимальный pass fixture (поля, которые использует cascade).
function makePass(overrides = {}) {
  return {
    id: 'pass-uuid',
    property_id: 'prop-uuid',
    pass_type: 'guest',
    status: 'active',
    valid_from: '2026-04-23T08:00:00Z',
    valid_until: '2026-04-23T23:00:00Z',
    ...overrides,
  };
}
function makeVehicle(overrides = {}) {
  return {
    id: 'veh-uuid',
    plate_number: 'A001AA77',
    is_whitelisted: false,
    is_blacklisted: false,
    ...overrides,
  };
}

const NOW = new Date('2026-04-23T12:00:00Z');

describe('computeVerdict — happy path', () => {
  test('active pass inside window → entry_allowed', () => {
    const v = computeVerdict({ mode: 'qr', pass: makePass(), vehicle: null, now: NOW });
    expect(v.allowed).toBe(true);
    expect(v.event_type).toBe('entry_allowed');
    expect(v.incident_type).toBe(null);
  });

  test('plate match with whitelisted vehicle and active pass → entry_allowed', () => {
    const v = computeVerdict({
      mode: 'plate',
      pass: makePass({ pass_type: 'vehicle' }),
      vehicle: makeVehicle({ is_whitelisted: true }),
      now: NOW,
    });
    expect(v.allowed).toBe(true);
  });
});

describe('computeVerdict — deny cascade (8 branches, priority order)', () => {
  test('1) invalid_qr: mode=qr and pass=null', () => {
    const v = computeVerdict({ mode: 'qr', pass: null, vehicle: null, now: NOW });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('invalid_qr');
    expect(v.incident_type).toBe('invalid_qr');
    expect(v.severity).toBe('medium');
  });

  test('2) blacklist beats expired: vehicle blacklisted wins over pass.expired', () => {
    // blacklist is high-severity — must come before expired in cascade.
    const v = computeVerdict({
      mode: 'plate',
      pass: makePass({ status: 'expired' }),
      vehicle: makeVehicle({ is_blacklisted: true }),
      now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('vehicle_blacklisted');
    expect(v.incident_type).toBe('blacklist_hit');
    expect(v.severity).toBe('high');
  });

  test('3a) pass_revoked: pass.status=revoked → blacklist_hit', () => {
    const v = computeVerdict({
      mode: 'qr', pass: makePass({ status: 'revoked' }), vehicle: null, now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('pass_revoked');
    expect(v.incident_type).toBe('blacklist_hit');
    expect(v.severity).toBe('high');
  });

  test('3b) pass_blocked: pass.status=blocked → blacklist_hit', () => {
    const v = computeVerdict({
      mode: 'qr', pass: makePass({ status: 'blocked' }), vehicle: null, now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('pass_blocked');
    expect(v.incident_type).toBe('blacklist_hit');
  });

  test('4) pass_used: one-shot pass уже сработал → deny pass_used', () => {
    const v = computeVerdict({
      mode: 'qr', pass: makePass({ status: 'used' }), vehicle: null, now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('pass_used');
    expect(v.incident_type).toBe('expired_pass_attempt');
    expect(v.severity).toBe('low');
  });

  test('5a) expired by status', () => {
    const v = computeVerdict({
      mode: 'qr', pass: makePass({ status: 'expired' }), vehicle: null, now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('expired');
    expect(v.incident_type).toBe('expired_pass_attempt');
    expect(v.severity).toBe('low');
  });

  test('5b) expired by time (now > valid_until even if status=active)', () => {
    const late = new Date('2026-04-24T00:30:00Z');
    const v = computeVerdict({
      mode: 'qr',
      pass: makePass({ valid_until: '2026-04-23T23:00:00Z' }),
      vehicle: null, now: late,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('expired');
  });

  test('6) outside_time_window: now < valid_from', () => {
    const early = new Date('2026-04-23T06:00:00Z');
    const v = computeVerdict({
      mode: 'qr',
      pass: makePass({ valid_from: '2026-04-23T08:00:00Z' }),
      vehicle: null, now: early,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('outside_time_window');
    expect(v.incident_type).toBe('outside_time_window');
    expect(v.severity).toBe('low');
  });

  test('7a) unauthorized_vehicle: plate match but no active pass and no whitelist', () => {
    const v = computeVerdict({
      mode: 'plate',
      pass: null,
      vehicle: makeVehicle({ is_whitelisted: false }),
      now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('unauthorized_vehicle');
    expect(v.incident_type).toBe('unauthorized_vehicle');
    expect(v.severity).toBe('medium');
  });

  test('7b) unknown plate (not in vehicles table) → unauthorized_vehicle', () => {
    const v = computeVerdict({
      mode: 'plate', pass: null, vehicle: null, now: NOW,
    });
    expect(v.allowed).toBe(false);
    expect(v.reason).toBe('unauthorized_vehicle');
    expect(v.incident_type).toBe('unauthorized_vehicle');
  });

  test('8) whitelisted vehicle without pass → allowed (safety-net for residents)', () => {
    const v = computeVerdict({
      mode: 'plate',
      pass: null,
      vehicle: makeVehicle({ is_whitelisted: true }),
      now: NOW,
    });
    expect(v.allowed).toBe(true);
    expect(v.event_type).toBe('entry_allowed');
  });
});

describe('computeVerdict — priority invariants', () => {
  test('blacklist beats pass.status=revoked for high-severity signal', () => {
    // Both would lead to high severity but blacklist is first in cascade —
    // visitor context prefers showing "vehicle blacklisted" over "pass revoked".
    const v = computeVerdict({
      mode: 'plate',
      pass: makePass({ status: 'revoked' }),
      vehicle: makeVehicle({ is_blacklisted: true }),
      now: NOW,
    });
    expect(v.reason).toBe('vehicle_blacklisted');
  });

  test('pass_used beats expired — одноразовое использование важнее expiry', () => {
    const v = computeVerdict({
      mode: 'qr',
      pass: makePass({ status: 'used', valid_until: '2020-01-01T00:00:00Z' }),
      vehicle: null, now: NOW,
    });
    expect(v.reason).toBe('pass_used');
  });

  test('outside_time_window не срабатывает на active+in-window pass', () => {
    const v = computeVerdict({
      mode: 'qr',
      pass: makePass(),  // default: valid_from < NOW < valid_until
      vehicle: null, now: NOW,
    });
    expect(v.allowed).toBe(true);
  });
});

describe('ONE_SHOT_PASS_TYPES sanity', () => {
  test('contains guest/courier/service only', () => {
    expect(ONE_SHOT_PASS_TYPES.has('guest')).toBe(true);
    expect(ONE_SHOT_PASS_TYPES.has('courier')).toBe(true);
    expect(ONE_SHOT_PASS_TYPES.has('service')).toBe(true);
    expect(ONE_SHOT_PASS_TYPES.has('resident')).toBe(false);
    expect(ONE_SHOT_PASS_TYPES.has('staff')).toBe(false);
    expect(ONE_SHOT_PASS_TYPES.has('vehicle')).toBe(false);
    expect(ONE_SHOT_PASS_TYPES.size).toBe(3);
  });
});
