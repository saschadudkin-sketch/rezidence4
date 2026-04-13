/**
 * requestsSlice.test.js — тесты reducer заявок
 */

import { requestsReducer } from './requestsSlice';

describe('requestsReducer', () => {
  const req1 = { id: 'r1', type: 'pass', status: 'pending', passDuration: 'once', createdAt: new Date(), arrivedAt: null };
  const req2 = { id: 'r2', type: 'pass', status: 'approved', passDuration: 'temporary', validUntil: new Date(Date.now() + 86400000), createdAt: new Date(), arrivedAt: null };
  const baseState = { requests: [req1, req2], history: {} };

  test('REQUEST_SET_STATUS changes status', () => {
    const action = { type: 'REQUEST_SET_STATUS', id: 'r1', status: 'approved' };
    const result = requestsReducer(baseState, action);
    expect(result.requests.find(r => r.id === 'r1').status).toBe('approved');
  });

  test('REQUEST_ARRIVE sets arrivedAt', () => {
    const now = new Date();
    const action = { type: 'REQUEST_ARRIVE', id: 'r1', arrivedAt: now };
    const result = requestsReducer(baseState, action);
    expect(result.requests.find(r => r.id === 'r1').arrivedAt).toBe(now);
  });

  test('REQUEST_ADD adds new request', () => {
    const newReq = { id: 'r3', type: 'tech', status: 'pending' };
    const action = { type: 'REQUEST_ADD', request: newReq };
    const result = requestsReducer(baseState, action);
    expect(result.requests).toHaveLength(3);
    expect(result.requests[0].id).toBe('r3');
  });

  test('REQUEST_DELETE removes request', () => {
    const action = { type: 'REQUEST_DELETE', id: 'r1' };
    const result = requestsReducer(baseState, action);
    expect(result.requests).toHaveLength(1);
    expect(result.requests[0].id).toBe('r2');
  });

  test('HISTORY_ADD appends history entry', () => {
    const action = { type: 'HISTORY_ADD', reqId: 'r1', byName: 'Охрана', byRole: 'security', label: 'Допуск разрешён', at: new Date() };
    const result = requestsReducer(baseState, action);
    expect(result.history.r1).toHaveLength(1);
    expect(result.history.r1[0].action).toBe('Допуск разрешён');
  });

  test('REQUEST_ACTIVATE_SCHEDULED expires old temporary passes', () => {
    const expired = { ...req2, validUntil: new Date(Date.now() - 1000), status: 'approved' };
    const state = { requests: [expired], history: {} };
    const action = { type: 'REQUEST_ACTIVATE_SCHEDULED' };
    const result = requestsReducer(state, action);
    expect(result.requests[0].status).toBe('expired');
  });

  test('REQUEST_ACTIVATE_SCHEDULED auto-approves resident once pass', () => {
    const scheduled = {
      id: 'r-scheduled',
      type: 'pass',
      status: 'scheduled',
      passDuration: 'once',
      createdByRole: 'owner',
      scheduledFor: new Date(Date.now() - 1000),
      createdAt: new Date(),
      arrivedAt: null,
    };
    const state = { requests: [scheduled], history: {} };
    const action = { type: 'REQUEST_ACTIVATE_SCHEDULED' };
    const result = requestsReducer(state, action);

    expect(result.requests[0].status).toBe('approved');
    expect(result.requests[0].scheduledFor).toBeNull();
  });

  test('unknown action returns state', () => {
    const result = requestsReducer(baseState, { type: 'UNKNOWN' });
    expect(result).toBe(baseState);
  });
});
