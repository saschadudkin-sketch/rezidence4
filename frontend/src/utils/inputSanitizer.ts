/**
 * inputSanitizer.ts — S2: Centralized input sanitization and validation.
 *
 * All user-facing form inputs should go through these helpers to enforce
 * consistent security invariants across the app. React auto-escapes all
 * rendered values by default (no XSS risk from {value} interpolation), but
 * normalized inputs prevent logic bugs, duplicate entries, and injection
 * via structured data fields.
 *
 * Usage:
 *   import { sanitizeText, sanitizePhone, validatePhone } from '../utils/inputSanitizer';
 *   const clean = sanitizeText(e.target.value);
 */

/** Trim and collapse internal whitespace in free-text inputs. */
export function sanitizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Normalize a Russian phone number to +7XXXXXXXXXX format.
 * Strips non-digits; handles 10-digit, 11-digit 8-prefixed, and +7-prefixed inputs.
 * Returns the original trimmed value if the format is not recognized.
 */
export function sanitizePhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) {
    return '+7' + digits.slice(1);
  }
  if (digits.length === 10) return '+7' + digits;
  return value.trim();
}

/** Normalize a car plate: uppercase letters, collapse spaces. */
export function sanitizeCarPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Validate a phone number. Returns an error string or null if valid/empty. */
export function validatePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null; // optional field
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 11) return 'Проверьте формат номера телефона';
  return null;
}

/** Validate a required field is non-empty. Returns an error string or null. */
export function validateRequired(value: string, label = 'Поле'): string | null {
  return value.trim() ? null : `${label} обязательно`;
}

/**
 * Validate that at least one of several values is non-empty.
 * Used for fields where either A or B must be provided (e.g. name OR car plate).
 */
export function validateAtLeastOne(values: string[], message: string): string | null {
  return values.some(v => v.trim()) ? null : message;
}
