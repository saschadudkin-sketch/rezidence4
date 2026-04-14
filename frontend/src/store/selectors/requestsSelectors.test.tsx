import { describe, expect, test } from 'vitest';
import { makeSelectResidentComputed } from './requestsSelectors';

const buildState = (requests) => ({
  reqState: { requests, history: {} },
  chatState: { chat: [], chatLastSeen: {} },
  usersState: { users: {}, phoneDb: {}, avatars: {} },
  permsState: { perms: {}, templates: {} },
  blacklistState: { blacklist: [] },
  garageState: { garage: {} },
});

describe('requestsSelectors', () => {
  test('memoizes resident computed collections', () => {
    const selector = makeSelectResidentComputed();
    const state = buildState([
      { id: 'r1', type: 'pass', status: 'pending', createdByUid: 'u1', createdAt: '2026-01-01T00:00:00.000Z' },
    ]);

    const first = selector(state, 'u1', 'active', 'active');
    const second = selector(state, 'u1', 'active', 'active');

    expect(second).toBe(first);
    expect(first.filteredPasses).toHaveLength(1);
  });
});
