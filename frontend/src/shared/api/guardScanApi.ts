/**
 * guardScanApi.ts — Phase 2 Guard QR scan API client wrappers.
 *
 * Mirrors backend/src/routes/guardScan.js.  Staff-only endpoints enforced
 * server-side; the frontend just forwards calls and handles typed responses.
 *
 * Flow:
 *   1. `scanPassToken(token)` — creates a `visit_logs` row with
 *      result='pending_guard_decision' and returns the scan context (guest
 *      identity, resident, pass validity).
 *   2. Guard sees the result screen (see views/guard/GuardScannerView).
 *   3. Guard clicks Admit → `admitScan(scanId)` (marks pass used, dispatches
 *      guest.arrived push) OR Deny → `denyScan(scanId, reason?)`.
 *
 * The server response intentionally never exposes the resident's UID or
 * phone — just name + apartment — so the guard can verify context without
 * seeing PII that's irrelevant to their decision.
 */

import { apiClient } from '../../services/providers/apiClient';

export type GuardScanPassState = 'valid' | 'used' | 'expired' | 'invalid';

export type GuardScanResult = {
  scanId: string;
  pass: {
    id: string;
    expiresAt: string;
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
    rawCode === 'VALIDATION' || rawCode === 'FORBIDDEN'
      ? rawCode
      : 'UNKNOWN';
  const message = typeof e?.message === 'string' && e.message ? e.message : 'Ошибка сканирования';
  return new GuardScanError(code, status, message);
}

export async function scanPassToken(token: string): Promise<GuardScanResult> {
  try {
    const res = await apiClient.post('/api/v1/guard/scan', { token });
    return res as GuardScanResult;
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function admitScan(scanId: string): Promise<void> {
  try {
    await apiClient.post(`/api/v1/guard/scan/${encodeURIComponent(scanId)}/admit`, {});
  } catch (err) {
    throw normalizeError(err);
  }
}

export async function denyScan(scanId: string, reason?: string): Promise<void> {
  try {
    await apiClient.post(
      `/api/v1/guard/scan/${encodeURIComponent(scanId)}/deny`,
      reason ? { reason } : {},
    );
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
