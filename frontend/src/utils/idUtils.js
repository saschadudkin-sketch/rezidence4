/** Генерирует уникальный ID с опциональным префиксом */
export const genId = (prefix = '') => {
  const id =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  return prefix + id;
};
