/**
 * utils/idUtils.test.js
 * Покрывает: genId — уникальность, префикс, формат
 */

import { genId } from './idUtils';

describe('genId', () => {
  it('возвращает строку', () => {
    expect(typeof genId()).toBe('string');
  });

  it('без префикса — возвращает непустую строку', () => {
    expect(genId().length).toBeGreaterThan(0);
  });

  it('с префиксом — строка начинается с префикса', () => {
    expect(genId('msg-').startsWith('msg-')).toBe(true);
    expect(genId('req-').startsWith('req-')).toBe(true);
  });

  it('два вызова дают разные ID', () => {
    const ids = new Set(Array.from({ length: 20 }, () => genId()));
    expect(ids.size).toBe(20);
  });

  it('ID без префикса имеет разумную длину (≥8 символов)', () => {
    expect(genId().length).toBeGreaterThanOrEqual(8);
  });

  it('ID содержит только буквы и цифры (без дефисов в самом ID)', () => {
    const id = genId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });

  it('ID с префиксом содержит префикс + буквы/цифры', () => {
    const id = genId('pfx-');
    expect(id).toMatch(/^pfx-[a-z0-9]+$/);
  });
});
