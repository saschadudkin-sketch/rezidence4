const pad2 = (value: number): string => String(value).padStart(2, '0');

export const toLocalDateInputValue = (date: string | number | Date): string => {
  const normalized = date instanceof Date ? date : new Date(date);
  return `${normalized.getFullYear()}-${pad2(normalized.getMonth() + 1)}-${pad2(normalized.getDate())}`;
};

export const toLocalDateTimeInputValue = (date: string | number | Date): string => {
  const normalized = date instanceof Date ? date : new Date(date);
  return `${toLocalDateInputValue(normalized)}T${pad2(normalized.getHours())}:${pad2(normalized.getMinutes())}`;
};

export const parseLocalDateInputValue = (value: string): Date | null => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
};
