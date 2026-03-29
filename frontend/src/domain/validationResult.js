export function normalizeValidationResult(result, { fallbackReason = 'error' } = {}) {
  if (result?.status === 'allowed' || result?.status === 'denied') {
    return {
      status: result.status,
      reason: result.reason || (result.status === 'allowed' ? 'ok' : fallbackReason),
    };
  }

  if (typeof result?.valid === 'boolean') {
    return {
      status: result.valid ? 'allowed' : 'denied',
      reason: result.reason || (result.valid ? 'ok' : fallbackReason),
    };
  }

  return { status: 'denied', reason: fallbackReason };
}

