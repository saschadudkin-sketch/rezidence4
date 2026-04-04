/** CQ-02: migrated from passValidation.js */

interface BlacklistItem {
  userId?: string;
  uid?: string;
  phone?: string;
  carPlate?: string;
}

interface PassData {
  userId?: string;
  uid?: string;
  visitorPhone?: string;
  carPlate?: string;
  validUntil?: string | Date | null;
}

interface ValidationResult {
  status: 'allowed' | 'denied';
  reason: string;
}

// FIX [BUG-2]: normalize phone to digits only for comparison
function normalizePhone(phone: unknown): string {
  if (typeof phone !== 'string') return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

// FIX [BUG-2]: normalize car plate — strip spaces, lowercase
function normalizeCarPlate(plate: unknown): string {
  return typeof plate === 'string' ? plate.replace(/\s/g, '').toLowerCase() : '';
}

export function validatePassByRules(
  pass: PassData | null | undefined,
  { blacklist = [], now = new Date() }: { blacklist?: BlacklistItem[]; now?: Date } = {},
): ValidationResult {
  if (!pass) return { status: 'denied', reason: 'not_found' };

  const validUntil = pass.validUntil ? new Date(pass.validUntil) : null;
  if (validUntil && validUntil.getTime() < now.getTime()) {
    return { status: 'denied', reason: 'expired' };
  }

  // FIX [BUG-2]: check blacklist by all available identifiers
  const passUserId = pass.userId ?? pass.uid;
  const passPhone  = normalizePhone(pass.visitorPhone);
  const passPlate  = normalizeCarPlate(pass.carPlate);

  const isBlacklisted = blacklist.some(item => {
    const itemUserId = item.userId ?? item.uid;
    if (itemUserId && passUserId && itemUserId === passUserId) return true;

    const itemPhone = normalizePhone(item.phone);
    if (itemPhone && passPhone && itemPhone === passPhone) return true;

    const itemPlate = normalizeCarPlate(item.carPlate);
    if (itemPlate && passPlate && itemPlate === passPlate) return true;

    return false;
  });

  if (isBlacklisted) {
    return { status: 'denied', reason: 'blacklisted' };
  }

  return { status: 'allowed', reason: 'ok' };
}
