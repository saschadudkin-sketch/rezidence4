import { canApproveScannedRequest, getScanDecision } from './scanDecision';

describe('canApproveScannedRequest', () => {
  test('allows pending request only for allowed validation', () => {
    expect(canApproveScannedRequest({ requestStatus: 'pending', validationStatus: 'allowed' })).toBe(true);
    expect(canApproveScannedRequest({ requestStatus: 'pending', validationStatus: 'denied' })).toBe(false);
  });

  test('allows approved request only for allowed validation', () => {
    expect(canApproveScannedRequest({ requestStatus: 'approved', validationStatus: 'allowed' })).toBe(true);
    expect(canApproveScannedRequest({ requestStatus: 'approved', validationStatus: null })).toBe(false);
  });

  test('rejects non-approvable statuses', () => {
    expect(canApproveScannedRequest({ requestStatus: 'cancelled', validationStatus: 'allowed' })).toBe(false);
    expect(canApproveScannedRequest({ requestStatus: 'rejected', validationStatus: 'allowed' })).toBe(false);
  });

  test('returns combined scan decision payload', () => {
    expect(getScanDecision({ requestStatus: 'pending', validationStatus: 'allowed' }))
      .toEqual({ deniedByValidation: false, canApprove: true });

    expect(getScanDecision({ requestStatus: 'pending', validationStatus: 'denied' }))
      .toEqual({ deniedByValidation: true, canApprove: false });
  });

  test('returns safe defaults for missing request status', () => {
    expect(getScanDecision({ requestStatus: undefined, validationStatus: 'allowed' }))
      .toEqual({ deniedByValidation: false, canApprove: false });
  });
});
