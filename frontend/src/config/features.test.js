/**
 * config/features.test.js
 */
import { FEATURES } from './features';

describe('FEATURES', () => {
  test('FIREBASE_LIVE является булевым', () => {
    expect(typeof FEATURES.FIREBASE_LIVE).toBe('boolean');
  });

  test('FIREBASE_LIVE = false (Firebase убран, используется backendProvider)', () => {
    // Это важная проверка регрессии: случайное включение Firebase в production
    // сломает аутентификацию через backendProvider
    expect(FEATURES.FIREBASE_LIVE).toBe(false);
  });
});
