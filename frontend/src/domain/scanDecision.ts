/** CQ-02: migrated from scanDecision.js */

interface ScanDecisionInput {
  requestStatus: string;
  validationStatus: string;
}

export function canApproveScannedRequest({ requestStatus, validationStatus }: ScanDecisionInput): boolean {
  if (validationStatus !== 'allowed') return false;
  return requestStatus === 'pending' || requestStatus === 'approved';
}

export function getScanDecision({ requestStatus, validationStatus }: ScanDecisionInput): {
  deniedByValidation: boolean;
  canApprove: boolean;
} {
  return {
    deniedByValidation: validationStatus === 'denied',
    canApprove: canApproveScannedRequest({ requestStatus, validationStatus }),
  };
}
