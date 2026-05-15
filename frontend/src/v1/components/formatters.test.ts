/**
 * Formatter tests — lock the mapping from backend enums to Russian labels
 * and tone strings so UI regressions are caught before screenshots.
 *
 * We don't exhaustively assert every Russian string (the map can evolve for
 * copy reasons without breaking UX), but we DO pin:
 *   - the happy-path label per enum (so translation drift is caught)
 *   - tone dispatch for request/pass status (these feed <Badge tone=...>)
 *   - formatDenyReason fall-through for unknown strings (forward-compat)
 *   - formatDateTime handles null/invalid input
 *
 * Why not snapshot?  Snapshots rot silently.  Explicit expectations force a
 * human eye on copy changes.
 */

import { describe, expect, test } from 'vitest';
import {
  formatDateTime,
  formatDenyReason,
  formatIncidentType,
  formatPassStatus,
  formatPassType,
  formatRequestStatus,
  formatRequestType,
  formatSeverity,
  formatWindow,
  passStatusTone,
  requestStatusTone,
  severityTone,
} from './formatters';

describe('formatters — enum → label', () => {
  test('request types cover every backend enum value', () => {
    expect(formatRequestType('guest_access')).toBe('Гость');
    expect(formatRequestType('vehicle_access')).toBe('Авто');
    expect(formatRequestType('contractor_access')).toBe('Подрядчик');
    expect(formatRequestType('courier_access')).toBe('Курьер');
    expect(formatRequestType('service_access')).toBe('Сервис');
    expect(formatRequestType('temporary_resident_access')).toBe('Временный резидент');
  });

  test('request statuses render correct Russian', () => {
    expect(formatRequestStatus('new')).toBe('Новая');
    expect(formatRequestStatus('pending_approval')).toBe('На согласовании');
    expect(formatRequestStatus('escalated')).toBe('Эскалирована');
    expect(formatRequestStatus('approved')).toBe('Одобрено');
    expect(formatRequestStatus('rejected')).toBe('Отклонено');
    expect(formatRequestStatus('cancelled')).toBe('Отменено');
    expect(formatRequestStatus('expired')).toBe('Истекло');
  });

  test('pass statuses + types render correct Russian', () => {
    expect(formatPassStatus('active')).toBe('Активен');
    expect(formatPassStatus('revoked')).toBe('Отозван');
    expect(formatPassType('guest')).toBe('Гость');
    expect(formatPassType('contractor')).toBe('Подрядчик');
    expect(formatPassType('emergency')).toBe('Экстренный');
  });

  test('incident types + severities render correct Russian', () => {
    expect(formatIncidentType('blacklist_hit')).toBe('Чёрный список');
    expect(formatIncidentType('invalid_plate')).toBe('Невалидный номер');
    expect(formatSeverity('critical')).toBe('Критическая');
    expect(formatSeverity('low')).toBe('Низкая');
  });
});

describe('formatDenyReason — forward compatibility', () => {
  test('known reasons render the mapped label', () => {
    expect(formatDenyReason('invalid_qr')).toBe('Невалидный QR-код');
    expect(formatDenyReason('vehicle_blacklisted')).toBe('Авто в чёрном списке');
    expect(formatDenyReason('idempotent_replay')).toBe('Повторный сигнал');
  });

  test('unknown reason from a future backend falls through verbatim', () => {
    // The backend may invent new reasons before the FE catches up; falling
    // through is preferable to showing "undefined" in the guard console.
    expect(formatDenyReason('some_future_reason')).toBe('some_future_reason');
  });

  test('missing reason resolves to a neutral "Отказ"', () => {
    expect(formatDenyReason(undefined)).toBe('Отказ');
  });
});

describe('tone dispatch — feeds <Badge tone=...>', () => {
  test('request status tones', () => {
    expect(requestStatusTone('approved')).toBe('success');
    expect(requestStatusTone('rejected')).toBe('error');
    expect(requestStatusTone('cancelled')).toBe('error');
    expect(requestStatusTone('pending_approval')).toBe('warning');
    expect(requestStatusTone('escalated')).toBe('warning');
    expect(requestStatusTone('new')).toBe('info');
    expect(requestStatusTone('expired')).toBe('neutral');
  });

  test('pass status tones', () => {
    expect(passStatusTone('active')).toBe('success');
    expect(passStatusTone('revoked')).toBe('error');
    expect(passStatusTone('blocked')).toBe('error');
    expect(passStatusTone('expired')).toBe('warning');
    expect(passStatusTone('used')).toBe('info');
  });

  test('severity tones', () => {
    expect(severityTone('critical')).toBe('error');
    expect(severityTone('high')).toBe('error');
    expect(severityTone('medium')).toBe('warning');
    expect(severityTone('low')).toBe('neutral');
  });
});

describe('formatDateTime / formatWindow', () => {
  test('null/undefined gets an em-dash placeholder', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
  });

  test('invalid date string falls through unchanged', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });

  test('valid ISO produces a Russian-locale compact string', () => {
    // Don't assert the full formatted string (timezone-dependent).  We only
    // care that the digits of the date appear and the output is non-empty.
    const out = formatDateTime('2026-04-23T10:15:00Z');
    expect(out).toMatch(/2026/);
    expect(out).toMatch(/04/);
  });

  test('same-day window is rendered compactly with one date', () => {
    const out = formatWindow('2026-04-23T10:00:00Z', '2026-04-23T12:00:00Z');
    // Expect exactly one "23.04" segment — the two times share a date label.
    expect(out.match(/23\.04/g)?.length ?? 0).toBe(1);
    expect(out).toContain('→');
  });
});
