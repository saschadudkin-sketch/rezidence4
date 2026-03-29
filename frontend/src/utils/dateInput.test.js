import {
  toLocalDateInputValue,
  toLocalDateTimeInputValue,
  parseLocalDateInputValue,
} from './dateInput';

describe('dateInput helpers', () => {
  test('toLocalDateInputValue formats by local calendar date without UTC shift', () => {
    const d = new Date(2026, 2, 24, 23, 45, 0, 0); // local time
    expect(toLocalDateInputValue(d)).toBe('2026-03-24');
  });

  test('toLocalDateTimeInputValue formats datetime-local value by local time', () => {
    const d = new Date(2026, 2, 24, 5, 7, 59, 999); // local time
    expect(toLocalDateTimeInputValue(d)).toBe('2026-03-24T05:07');
  });

  test('parseLocalDateInputValue parses YYYY-MM-DD as local date', () => {
    const d = parseLocalDateInputValue('2026-03-24');
    expect(d).toBeInstanceOf(Date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(24);
  });

  test('parseLocalDateInputValue returns null for invalid or out-of-range values', () => {
    expect(parseLocalDateInputValue('2026-02-31')).toBeNull();
    expect(parseLocalDateInputValue('2026-2-3')).toBeNull();
    expect(parseLocalDateInputValue('not-a-date')).toBeNull();
  });
});
