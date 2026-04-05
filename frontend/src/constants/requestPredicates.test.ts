/**
 * constants/requestPredicates.test.js
 */

import {
  isActiveRequest, isCompletedRequest, isPendingRequest,
  isApprovedRequest, isScheduledRequest, shouldShowActions,
} from './requestPredicates';

const req = (status) => ({ status, type: 'pass', category: 'guest' });

test('isActiveRequest: pending и approved активны', () => {
  expect(isActiveRequest(req('pending'))).toBe(true);
  expect(isActiveRequest(req('approved'))).toBe(true);
  expect(isActiveRequest(req('cancelled'))).toBe(false);
  expect(isActiveRequest(req('arrived'))).toBe(false);
});

test('isCompletedRequest: включает cancelled', () => {
  expect(isCompletedRequest(req('cancelled'))).toBe(true);
  expect(isCompletedRequest(req('rejected'))).toBe(true);
  expect(isCompletedRequest(req('arrived'))).toBe(true);
  expect(isCompletedRequest(req('pending'))).toBe(false);
});

test('isPendingRequest: только pending', () => {
  expect(isPendingRequest(req('pending'))).toBe(true);
  expect(isPendingRequest(req('approved'))).toBe(false);
});

test('isScheduledRequest: только scheduled', () => {
  expect(isScheduledRequest(req('scheduled'))).toBe(true);
  expect(isScheduledRequest(req('pending'))).toBe(false);
});

test('shouldShowActions: onCancel раскрывает pending/approved', () => {
  const onCancel = () => {};
  expect(shouldShowActions(req('pending'),  { onCancel })).toBe(true);
  expect(shouldShowActions(req('approved'), { onCancel })).toBe(true);
  expect(shouldShowActions(req('cancelled'),{ onCancel })).toBe(false);
});

test('shouldShowActions: персонал всегда видит кнопки', () => {
  expect(shouldShowActions(req('pending'), { userRole: 'security' })).toBe(true);
  expect(shouldShowActions(req('arrived'), { userRole: 'admin' })).toBe(true);
});
