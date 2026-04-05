/**
 * utils/phoneUtils.test.js
 */

import { normalizePhone, findByPhone } from './phoneUtils';

describe('normalizePhone', () => {
  it('нормализует 10-значный номер (без 7/8 префикса)', () => {
    expect(normalizePhone('9161234567')).toBe('79161234567');
  });

  it('нормализует номер с 8 в начале', () => {
    expect(normalizePhone('89161234567')).toBe('79161234567');
  });

  it('нормализует номер с 7 в начале', () => {
    expect(normalizePhone('79161234567')).toBe('79161234567');
  });

  it('убирает нечисловые символы', () => {
    expect(normalizePhone('+7 (916) 123-45-67')).toBe('79161234567');
  });

  it('возвращает пустую строку для null', () => {
    expect(normalizePhone(null)).toBe('');
  });

  it('возвращает пустую строку для пустой строки', () => {
    expect(normalizePhone('')).toBe('');
  });
});

describe('findByPhone', () => {
  const db = { '79161234567': { uid: 'u1', name: 'Test' } };

  it('находит пользователя по нормализованному номеру', () => {
    expect(findByPhone('89161234567', db)).toEqual({ uid: 'u1', name: 'Test' });
  });

  it('возвращает null если не найден', () => {
    expect(findByPhone('79990000000', db)).toBeNull();
  });
});
