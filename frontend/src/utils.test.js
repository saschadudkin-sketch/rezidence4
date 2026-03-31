/**
 * utils.test.js
 * Проверяет что barrel-файл реэкспортирует все нужные функции
 * и что они работают (smoke test)
 */
import {
  normalizePhone, findByPhone,
  genId,
  fmtDate, fmtTime, filterByPeriod, groupReqs, sortReqs,
  requestNotifPerm, sendNotif, playAlert,
  registerSW,
} from './utils.js';

// Мокируем notifUtils / swUtils чтобы не трогать реальный браузер API
vi.mock('./utils/notifUtils', () => ({
  requestNotifPerm: vi.fn(),
  sendNotif:        vi.fn(),
  playAlert:        vi.fn(),
}));
vi.mock('./utils/swUtils', () => ({
  registerSW: vi.fn(),
}));

describe('utils.js barrel exports', () => {
  test('normalizePhone экспортируется и является функцией', () => {
    expect(typeof normalizePhone).toBe('function');
  });

  test('findByPhone экспортируется и является функцией', () => {
    expect(typeof findByPhone).toBe('function');
  });

  test('genId экспортируется и возвращает строку', () => {
    expect(typeof genId).toBe('function');
    expect(typeof genId()).toBe('string');
  });

  test('fmtDate экспортируется и возвращает строку', () => {
    expect(typeof fmtDate).toBe('function');
    expect(fmtDate(null)).toBe('');
  });

  test('fmtTime экспортируется и возвращает строку', () => {
    expect(typeof fmtTime).toBe('function');
    expect(fmtTime(null)).toBe('');
  });

  test('filterByPeriod экспортируется и работает', () => {
    expect(typeof filterByPeriod).toBe('function');
    expect(filterByPeriod([], 'all')).toEqual([]);
  });

  test('groupReqs экспортируется и работает', () => {
    expect(typeof groupReqs).toBe('function');
    expect(groupReqs([])).toEqual([]);
  });

  test('sortReqs экспортируется и работает', () => {
    expect(typeof sortReqs).toBe('function');
    expect(sortReqs([])).toEqual([]);
  });

  test('requestNotifPerm экспортируется и является функцией', () => {
    expect(typeof requestNotifPerm).toBe('function');
  });

  test('sendNotif экспортируется и является функцией', () => {
    expect(typeof sendNotif).toBe('function');
  });

  test('playAlert экспортируется и является функцией', () => {
    expect(typeof playAlert).toBe('function');
  });

  test('registerSW экспортируется и является функцией', () => {
    expect(typeof registerSW).toBe('function');
  });
});
