import { describe, expect, test } from 'vitest';
import {
  makeSelectGuardCollections,
  makeSelectResidentComputed,
  makeSelectResidentsDirectory,
  makeSelectTemplatesByType,
  makeSelectVisitLogCollections,
} from './requestsSelectors';

const buildState = (requests, overrides = {}) => ({
  reqState: { requests, history: {} },
  chatState: { chat: [], chatLastSeen: {} },
  usersState: { users: {}, phoneDb: {}, avatars: {} },
  permsState: { perms: {}, templates: {} },
  blacklistState: { blacklist: [] },
  garageState: { garage: {} },
  ...overrides,
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

  test('memoizes guard operational collections and search filtering', () => {
    const selector = makeSelectGuardCollections();
    const state = buildState([
      { id: 'p1', type: 'pass', status: 'approved', createdAt: '2026-01-01T00:00:00.000Z', visitorName: 'Анна' },
      { id: 't1', type: 'tech', status: 'pending', createdAt: '2026-01-02T00:00:00.000Z', comment: 'Лифт' },
    ]);

    const first = selector(state, 'анна');
    const second = selector(state, 'анна');

    expect(second).toBe(first);
    expect(first.approved).toHaveLength(1);
    expect(first.filteredApproved).toHaveLength(1);
    expect(first.filteredTechPending).toHaveLength(0);
  });

  test('builds resident directory groups from bounded context slices', () => {
    const selector = makeSelectResidentsDirectory();
    const state = buildState([], {
      usersState: {
        users: {
          u1: { uid: 'u1', role: 'owner', name: 'Анна', phone: '+7 900', apartment: '12', parkingSpot: 'P1' },
        },
        phoneDb: {},
        avatars: {},
      },
      permsState: {
        perms: { u1: { visitors: [{ id: 'v1', name: 'Гость', phone: '+7 901' }], workers: [] } },
        templates: {},
      },
      garageState: {
        garage: { u1: [{ id: 'c1', plate: 'A001AA77' }] },
      },
    });

    const result = selector(state, 'a001');

    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].cars).toHaveLength(1);
    expect(result.filtered[0].residents[0].perms.visitors).toHaveLength(1);
  });

  test('splits templates by type without recomputing in views', () => {
    const selector = makeSelectTemplatesByType();
    const state = buildState([], {
      permsState: {
        perms: {},
        templates: {
          u1: [
            { id: 'pass', type: 'pass', name: 'Гость', category: 'guest', visitorName: '', visitorPhone: '', carPlate: '', comment: '' },
            { id: 'tech', type: 'tech', name: 'Сантехник', category: 'plumber', visitorName: '', visitorPhone: '', carPlate: '', comment: '' },
          ],
        },
      },
    });

    const result = selector(state, 'u1');

    expect(result.passes.map((item) => item.id)).toEqual(['pass']);
    expect(result.tech.map((item) => item.id)).toEqual(['tech']);
  });

  test('joins visit log events with request snapshots in selector layer', () => {
    const selector = makeSelectVisitLogCollections();
    const state = buildState([
      {
        id: 'r1',
        type: 'pass',
        status: 'arrived',
        createdAt: '2026-01-01T00:00:00.000Z',
        createdByUid: 'u1',
        createdByName: 'Анна',
        createdByApt: '12',
        visitorName: 'Гость',
      },
    ]);

    const result = selector(
      state,
      [{ id: 'v1', requestId: 'r1', result: 'allowed', timestamp: '2026-01-01T01:00:00.000Z' }],
      'owner',
      'u1',
      'all',
      'all',
      'гость',
    );

    expect(result.visits).toHaveLength(1);
    expect(result.groups[0].items[0].visitorName).toBe('Гость');
  });
});
