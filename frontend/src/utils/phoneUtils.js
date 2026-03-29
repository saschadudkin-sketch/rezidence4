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
