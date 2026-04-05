import { normalizeValidationResult } from './validationResult';

describe('normalizeValidationResult', () => {
  test('keeps canonical denied result', () => {
    expect(normalizeValidationResult({ status: 'denied', reason: 'cancelled' }))
      .toEqual({ status: 'denied', reason: 'cancelled' });
  });

  test('normalizes legacy valid=false shape', () => {
    expect(normalizeValidationResult({ valid: false, reason: 'blacklisted' }))
      .toEqual({ status: 'denied', reason: 'blacklisted' });
  });

  test('normalizes legacy valid=true shape', () => {
    expect(normalizeValidationResult({ valid: true, reason: 'ok' }))
      .toEqual({ status: 'allowed', reason: 'ok' });
  });

  test('returns fail-closed fallback for invalid payload', () => {
    expect(normalizeValidationResult(null))
      .toEqual({ status: 'denied', reason: 'error' });
  });

  test('fills default allowed reason when missing', () => {
    expect(normalizeValidationResult({ status: 'allowed' }))
      .toEqual({ status: 'allowed', reason: 'ok' });
  });

  test('uses custom fallback reason for invalid payload', () => {
    expect(normalizeValidationResult(undefined, { fallbackReason: 'not_found' }))
      .toEqual({ status: 'denied', reason: 'not_found' });
  });

  test('fails closed for unknown status payload', () => {
    expect(normalizeValidationResult({ status: 'weird' }))
      .toEqual({ status: 'denied', reason: 'error' });
  });

  test('fills denied fallback reason when missing', () => {
    expect(normalizeValidationResult({ status: 'denied' }))
      .toEqual({ status: 'denied', reason: 'error' });
  });
});
