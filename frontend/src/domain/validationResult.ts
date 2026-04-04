/** CQ-02: migrated from validationResult.js */

export interface ValidationResult {
  status: 'allowed' | 'denied';
  reason: string;
}

interface LegacyResult {
  status?: 'allowed' | 'denied';
  valid?: boolean;
  reason?: string;
}

export function normalizeValidationResult(
  result: LegacyResult | null | undefined,
  { fallbackReason = 'error' }: { fallbackReason?: string } = {},
): ValidationResult {
  if (result?.status === 'allowed' || result?.status === 'denied') {
    return {
      status: result.status,
      reason: result.reason ?? (result.status === 'allowed' ? 'ok' : fallbackReason),
    };
  }

  if (typeof result?.valid === 'boolean') {
    return {
      status: result.valid ? 'allowed' : 'denied',
      reason: result.reason ?? (result.valid ? 'ok' : fallbackReason),
    };
  }

  return { status: 'denied', reason: fallbackReason };
}
