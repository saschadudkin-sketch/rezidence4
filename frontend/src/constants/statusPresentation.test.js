import {
  getValidationReasonLabel,
  getStatusToneClass,
} from './statusPresentation';

describe('statusPresentation', () => {
  test('maps known validation reasons to russian labels', () => {
    expect(getValidationReasonLabel('expired')).toBe('Срок пропуска истёк');
    expect(getValidationReasonLabel('manual_reject')).toBe('Ручной отказ охраной');
  });

  test('fallbacks to raw reason for unknown values', () => {
    expect(getValidationReasonLabel('custom_reason')).toBe('custom_reason');
  });

  test('forces rejected tone when validation denied', () => {
    expect(getStatusToneClass('approved', 'denied')).toBe('rejected');
    expect(getStatusToneClass('approved', 'allowed')).toBe('approved');
  });

  test('maps cancelled status to rejected tone', () => {
    expect(getStatusToneClass('cancelled')).toBe('rejected');
  });

  test('falls back to pending tone for unknown status', () => {
    expect(getStatusToneClass('mystery_status')).toBe('pending');
  });
});
