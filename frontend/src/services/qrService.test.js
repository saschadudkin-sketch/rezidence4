/**
 * qrService.test.js — тесты генерации и парсинга QR
 */

import { parsePassQR } from './qrService';

describe('parsePassQR', () => {
  test('parses valid QR JSON', () => {
    const raw = JSON.stringify({ id: 'r1', type: 'pass', category: 'guest' });
    const result = parsePassQR(raw);
    expect(result).toEqual({ id: 'r1', type: 'pass', category: 'guest' });
  });

  test('returns null for invalid JSON', () => {
    expect(parsePassQR('not json')).toBeNull();
  });

  test('returns null for JSON without id', () => {
    expect(parsePassQR(JSON.stringify({ type: 'pass' }))).toBeNull();
  });

  test('returns null for JSON without type', () => {
    expect(parsePassQR(JSON.stringify({ id: 'r1' }))).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parsePassQR('')).toBeNull();
  });
});
