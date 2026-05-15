/**
 * guardScanApi.ts — Phase 2 Guard QR scan API client wrappers.
 *
 * Mirrors backend/src/v1/routes/visits.js.  Staff-only endpoints enforced
 * server-side; the frontend just forwards calls and handles typed responses.
 *
 * Flow:
 *   1. `scanPassToken(propertyId, token)` verifies through
 *      POST /api/v1/guard/scan-pass and returns the guard verdict.
 *   2. Guard sees the result screen (see views/guard/GuardScannerView).
 *   3. The canonical v1 endpoint records the visit decision server-side.
 *
 * The server response intentionally never exposes the resident's UID or
 * phone — just name + apartment — so the guard can verify context without
 * seeing PII that's irrelevant to their decision.
 */

import { apiClient } from '../../services/providers/apiClient';

export type GuardScanPassState = 'valid' | 'used' | 'expired' | 'invalid';

export type GuardScanResult = {
  scanId: string | null;
  allowed: boolean;
  reason: string | null;
  visitLogId: string | null;
  incidentId: string | null;
  pass: {
    id: string | null;
    expiresAt: string | null;
    usedAt: string | null;
  };
  request: {
    id: string;
    type: string;
    visitorName: string | null;
    visitorPhone: string | null;
    createdByApt: string | null;
  };
  resident: {
    name: string | null;
    apartment: string | null;
  };
};

/**
 * ApiClient errors carry a `.code` matching the backend `error.code` field.
 * The guardScan router uses PASS_INVALID / PASS_EXPIRED for 422s — we surface
 * them as typed rejections so the UI can render the reference design's red
 * "Недействителен" / "Срок истёк" banner without string-sniffing.
 */
export type GuardScanErrorCode =
  | 'NOT_FOUND'
  | 'PASS_EXPIRED'
  | 'PASS_INVALID'
  | 'PASS_USED'
  | 'POLICY_DENIED'
  | 'VALIDATION'
  | 'FORBIDDEN'
  | 'UNKNOWN';

export class GuardScanError extends Error {
  readonly code: GuardScanErrorCode;
  readonly status: number;

  constructor(code: GuardScanErrorCode, status: number, message: string) {
    super(message);
    this.name = 'GuardScanError';
    this.code = code;
    this.status = status;
  }
}

function normalizeError(err: unknown): GuardScanError {
  if (err instanceof GuardScanError) return err;
  const e = err as { status?: number; code?: string; message?: string } | null;
  const status = typeof e?.status === 'number' ? e.status : 0;
  const rawCode = typeof e?.code === 'string' ? e.code : '';
  const code: GuardScanErrorCode =
    rawCode === 'NOT_FOUND' || rawCode === 'PASS_EXPIRED' || rawCode === 'PASS_INVALID' ||
    rawCode === 'PASS_USED' || rawCode === 'POLICY_DENIED' ||
    rawCode === 'VALIDATION' || rawCode === 'FORBIDDEN'
      ? rawCode
      : 'UNKNOWN';
  const message = typeof e?.message === 'string' && e.message ? e.message : 'Ошибка сканирования';
  return new GuardScanError(code, status, message);
}

function reasonToErrorCode(reason: string | null | undefined): GuardScanErrorCode {
  if (reason === 'expired') return 'PASS_EXPIRED';
  if (reason === 'pass_revoked' || reason === 'pass_blocked' || reason === 'invalid_qr') return 'PASS_INVALID';
  if (reason === 'pass_used') return 'PASS_USED';
  if (reason === 'policy_denied' || reason === 'unauthorized_vehicle') return 'POLICY_DENIED';
  return 'UNKNOWN';
}

type ScanPassResponse = {
  allowed: boolean;
  reason: string | null;
  visit_log_id: string | null;
  incident_id: string | null;
  pass?: {
    id?: string | null;
    pass_type?: string | null;
    valid_until?: string | null;
    status?: string | null;
  } | null;
};

export async function scanPassToken(propertyId: string, token: string): Promise<GuardScanResult> {
  try {
    const res = await apiClient.post('/api/v1/guard/scan-pass', {
      property_id: propertyId,
      mode: 'qr',
      token,
      direction: 'entry',
    }) as ScanPassResponse;
    if (!res.allowed) {
      throw new GuardScanError(reasonToErrorCode(res.reason), 422, res.reason || 'Access denied');
    }
    return {
      scanId: res.visit_log_id,
      allowed: res.allowed,
      reason: res.reason,
      visitLogId: res.visit_log_id,
      incidentId: res.incident_id,
      pass: {
        id: res.pass?.id ?? null,
        expiresAt: res.pass?.valid_until ?? null,
        usedAt: res.pass?.status === 'used' ? new Date().toISOString() : null,
      },
      request: {
        id: '',
        type: res.pass?.pass_type ?? 'pass',
        visitorName: null,
        visitorPhone: null,
        createdByApt: null,
      },
      resident: {
        name: null,
        apartment: null,
      },
    };
  } catch (err) {
    throw normalizeError(err);
  }
}

/**
 * Extract a 64-hex pass token from a scanned QR payload.  The guest-pass page
 * (see views/public/GuestPassPage) encodes the URL `https://domhub.su/p/<token>`
 * into its QR, so most scans will be URLs — but we also accept the raw token
 * for compatibility with future native/NFC flows.
 *
 * Returns null if the input is not a recognisable token carrier.
 */
const TOKEN_RE = /^[0-9a-f]{64}$/i;

export function extractPassToken(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (TOKEN_RE.test(trimmed)) return trimmed.toLowerCase();

  // Try URL form: /p/<token> anywhere in the path.
  try {
    const url = new URL(trimmed, 'https://domhub.su');
    const match = url.pathname.match(/\/p\/([0-9a-f]{64})(?:\/|$)/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // not a URL — fall through
  }
  return null;
}
