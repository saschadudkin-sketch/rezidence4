/**
 * config/features.test.js
 */
import { FEATURES } from './features';

describe('FEATURES', () => {
  test('объект features существует', () => {
    expect(FEATURES).toBeDefined();
    expect(typeof FEATURES).toBe('object');
  });

  test('legacy-флагов больше нет', () => {
    const keys = Object.keys(FEATURES);
    expect(keys.some((k) => k.includes('LIVE'))).toBe(false);
  });
});
