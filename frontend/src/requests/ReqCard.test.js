/**
 * ReqCard.test.js — тесты карточки заявки
 */

import { isActiveRequest, isCompletedRequest, isPendingRequest } from '../constants/requestPredicates.js';

describe('Request predicates', () => {
  const pending  = { status: 'pending' };
  const approved = { status: 'approved' };
  const rejected = { status: 'rejected' };
  const arrived  = { status: 'arrived' };
  const expired  = { status: 'expired' };
  const accepted = { status: 'accepted' };

  test('isPendingRequest', () => {
    expect(isPendingRequest(pending)).toBe(true);
    expect(isPendingRequest(approved)).toBe(false);
  });

  test('isActiveRequest includes pending and approved', () => {
    expect(isActiveRequest(pending)).toBe(true);
    expect(isActiveRequest(approved)).toBe(true);
    expect(isActiveRequest(rejected)).toBe(false);
    expect(isActiveRequest(arrived)).toBe(false);
  });

  test('isCompletedRequest includes rejected, accepted, arrived, expired', () => {
    expect(isCompletedRequest(rejected)).toBe(true);
    expect(isCompletedRequest(accepted)).toBe(true);
    expect(isCompletedRequest(arrived)).toBe(true);
    expect(isCompletedRequest(expired)).toBe(true);
    expect(isCompletedRequest(pending)).toBe(false);
    expect(isCompletedRequest(approved)).toBe(false);
  });
});

// FIX [BUG-1]: Проверяем что act() использует ref для actLoading, а не stale closure
describe('ReqCard act() stale closure fix', () => {
  test('act() is an async function (not wrapping setTimeout)', () => {
    // Проверяем через исходный код — async act = стабильный callback без stale deps
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    expect(src).toMatch(/const act = useCallback\(async/);
    expect(src).not.toMatch(/\}, \[actLoading\]\)/); // старый stale closure dep
  });

  test('actLoadingRef pattern присутствует (нет stale closure)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    expect(src).toContain('actLoadingRef.current');
  });

  test('isMountedRef присутствует (защита от setState на unmounted)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    expect(src).toContain('isMountedRef.current');
  });

  test('ReqCard обёрнут в memo (нет лишних ре-рендеров)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    expect(src).toMatch(/export const ReqCard = memo/);
  });

  test('ReqPhoto обёрнут в memo', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    expect(src).toMatch(/const ReqPhoto = memo/);
  });
});

// UI-08: Double-click prevention — act() использует ref вместо state для guard.
// Тестируем инварианты через анализ исходного кода.
describe('ReqCard double-click prevention', () => {
  test('act() проверяет actLoadingRef.current перед запуском (guard против двойного клика)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    // Guard должен быть: if (actLoadingRef.current) return;
    expect(src).toMatch(/if \(actLoadingRef\.current\) return/);
  });

  test('actLoadingRef синхронизируется с actLoading state на каждом рендере', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    // actLoadingRef.current = actLoading; — синхронизация в теле компонента
    expect(src).toContain('actLoadingRef.current = actLoading');
  });

  test('act() — useCallback без actLoading в deps (нет stale closure)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    // stable callback — deps массив должен быть [], а не [actLoading, ...]
    expect(src).toMatch(/\}, \[\]\); \/\/ стабильный/);
  });

  test('dateLabel вычисляется через useMemo, а не IIFE', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./ReqCard.jsx'), 'utf8');
    expect(src).toContain('const dateLabel = useMemo');
    // Не должно быть IIFE-паттерна в JSX для dateLabel
    expect(src).not.toMatch(/\{.*\(\(\) => \{.*fmtDate.*\}\)\(\)\}/s);
  });
});
