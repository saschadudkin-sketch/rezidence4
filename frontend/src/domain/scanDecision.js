export function canApproveScannedRequest({ requestStatus, validationStatus }) {
  if (validationStatus !== 'allowed') return false;
  return requestStatus === 'pending' || requestStatus === 'approved';
}

export function getScanDecision({ requestStatus, validationStatus }) {
  return {
    deniedByValidation: validationStatus === 'denied',
    canApprove: canApproveScannedRequest({ requestStatus, validationStatus }),
  };
}
