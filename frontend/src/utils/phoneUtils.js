/**
 * A-07: formatPhone extracted from Login.jsx — belongs with phone utilities.
 * Formats a raw phone input to +7 XXX XXX-XX-XX style for display.
 */
export function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 1) return '+7 ';
  if (digits.length <= 4) return `+7 ${digits.slice(1)}`;
  if (digits.length <= 7) return `+7 ${digits.slice(1, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9) return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7)}`;
  return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
}

/** Нормализует номер к формату 7XXXXXXXXXX (11 цифр) */
export const normalizePhone = (p) => {
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return '7' + digits;   // 9161234567 → 79161234567
  return digits.replace(/^8/, '7');                 // 89161234567 → 79161234567
};

/** Ищет пользователя по номеру телефона в переданном phoneDb */
export const findByPhone = (p, phoneDb) => phoneDb[normalizePhone(p)] || null;
