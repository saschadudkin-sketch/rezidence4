/**
 * phoneUtils.ts — CQ-02: migrated from phoneUtils.js
 * A-07: formatPhone was extracted from Login.jsx and added here.
 */

/**
 * formatPhone — formats raw phone input to +7 XXX XXX-XX-XX display style.
 */
export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 1) return '+7 ';
  if (digits.length <= 4) return `+7 ${digits.slice(1)}`;
  if (digits.length <= 7) return `+7 ${digits.slice(1, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9) return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
}

/** Normalizes a phone number to 7XXXXXXXXXX format (11 digits) */
export const normalizePhone = (p: string): string => {
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '7' + digits;   // 9161234567 → 79161234567
  return digits.replace(/^8/, '7');                 // 89161234567 → 79161234567
};

/** Finds a user by phone number in the provided phoneDb map */
export const findByPhone = (p: string, phoneDb: Record<string, unknown>): unknown =>
  phoneDb[normalizePhone(p)] ?? null;
