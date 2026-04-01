'use strict';
/**
 * __tests__/requests_service_validation.test.js
 *
 * FIX [AUDIT]: тесты на validateFieldLengths в RequestsService.
 * Покрывает:
 *   1. historyLabel > 200 → ServiceError 400
 *   2. comment > 2000 → ServiceError 400
 *   3. visitorName > 200 → ServiceError 400
 *   4. Все поля в норме → не бросает
 *   5. FIELD_MAX применяется и в create(), и в update()
 */

jest.mock('../db');

const db = require('../db');
const { RequestsService, ServiceError } = require('../services/RequestsService');

process.env.JWT_SECRET = 'test-secret-key-min16chars-xxxxx';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const adminUser  = { uid: 'admin-1', name: 'Администратор', role: 'admin' };
const ownerUser  = { uid: 'owner-1', name: 'Иванов', role: 'owner' };

function mockExistingRequest(overrides = {}) {
  return {
    id: 'req-1',
    status: 'pending',
    created_by_uid: 'owner-1',
    ...overrides,
  };
}

function mockTxClient(queryImpl) {
  return {
    query: jest.fn(queryImpl),
    release: jest.fn(),
  };
}

// ─── create() — валидация длины ───────────────────────────────────────────────

describe('RequestsService.create() — validateFieldLengths', () => {
  beforeEach(() => jest.clearAllMocks());

  test('400 когда comment > 2000 символов', async () => {
    await expect(
      RequestsService.create(ownerUser, {
        type: 'pass', category: 'guest',
        comment: 'X'.repeat(2001),
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('comment too long'), status: 400 });
  });

  test('400 когда visitorName > 200 символов', async () => {
    await expect(
      RequestsService.create(ownerUser, {
        type: 'pass', category: 'guest',
        visitorName: 'А'.repeat(201),
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('visitorName too long'), status: 400 });
  });

  test('400 когда visitorPhone > 30 символов', async () => {
    await expect(
      RequestsService.create(ownerUser, {
        type: 'pass', category: 'guest',
        visitorPhone: '+7' + '9'.repeat(30),
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('visitorPhone too long'), status: 400 });
  });

  test('400 когда carPlate > 20 символов', async () => {
    await expect(
      RequestsService.create(ownerUser, {
        type: 'pass', category: 'guest',
        carPlate: 'А'.repeat(21),
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('carPlate too long'), status: 400 });
  });

  test('не бросает при полях в допустимых границах', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        id: 'req-new', type: 'pass', category: 'guest', status: 'pending',
        created_by_uid: 'owner-1', created_by_name: 'Иванов', created_by_role: 'owner',
        created_by_apt: null, visitor_name: 'Гость', visitor_phone: null,
        car_plate: null, comment: 'Норм', pass_duration: 'once',
        valid_until: null, scheduled_for: null, arrived_at: null, photos: [],
        created_at: new Date(), updated_at: new Date(),
      }],
    });

    await expect(
      RequestsService.create(ownerUser, {
        type: 'pass', category: 'guest',
        visitorName: 'Гость',
        comment: 'Норм',
      })
    ).resolves.toBeDefined();
  });
});

// ─── update() — historyLabel ──────────────────────────────────────────────────

describe('RequestsService.update() — historyLabel validation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('400 когда historyLabel > 200 символов', async () => {
    const mockClient = mockTxClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
      if (sql.includes('FOR UPDATE')) return { rows: [mockExistingRequest()] };
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    db.pool.connect.mockResolvedValueOnce(mockClient);

    await expect(
      RequestsService.update(adminUser, 'req-1', {
        status: 'approved',
        historyLabel: 'Х'.repeat(201),
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('historyLabel too long'),
      status: 400,
    });
  });

  test('не бросает при historyLabel ровно 200 символов (граница)', async () => {
    const mockClient = {
      query: jest.fn()
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [mockExistingRequest()] }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({   // UPDATE
          rows: [{
            id: 'req-1', type: 'pass', category: 'guest', status: 'approved',
            created_by_uid: 'owner-1', created_by_name: 'Иванов', created_by_role: 'owner',
            created_by_apt: null, visitor_name: null, visitor_phone: null,
            car_plate: null, comment: '', pass_duration: 'once',
            valid_until: null, scheduled_for: null, arrived_at: null, photos: [],
            created_at: new Date(), updated_at: new Date(),
          }],
        })
        .mockResolvedValueOnce({}) // INSERT history
        .mockResolvedValueOnce({}), // COMMIT
      release: jest.fn(),
    };
    db.pool.connect.mockResolvedValueOnce(mockClient);

    await expect(
      RequestsService.update(adminUser, 'req-1', {
        status: 'approved',
        historyLabel: 'Х'.repeat(200), // ровно на границе
      })
    ).resolves.toBeDefined();
  });

  test('400 когда comment > 2000 в update()', async () => {
    const mockClient = mockTxClient(async (sql) => {
      if (sql === 'BEGIN' || sql === 'ROLLBACK') return {};
      if (sql.includes('FOR UPDATE')) return { rows: [mockExistingRequest()] };
      throw new Error(`Unexpected SQL in test: ${sql}`);
    });
    db.pool.connect.mockResolvedValueOnce(mockClient);

    await expect(
      RequestsService.update(ownerUser, 'req-1', {
        comment: 'Y'.repeat(2001),
      })
    ).rejects.toMatchObject({ message: expect.stringContaining('comment too long'), status: 400 });
  });

  test('single-winner для двух параллельных update(status=cancelled) запросов', async () => {
    let locked = false;
    let status = 'pending';

    const makeClient = () => {
      const client = {
        query: jest.fn(async (sql, params) => {
          if (sql === 'BEGIN') return {};
          if (sql === 'COMMIT') {
            locked = false;
            return {};
          }
          if (sql === 'ROLLBACK') {
            locked = false;
            return {};
          }
          if (sql.includes('FOR UPDATE')) {
            while (locked) {
              await new Promise(resolve => setTimeout(resolve, 0));
            }
            locked = true;
            return { rows: [{ id: 'req-1', status, created_by_uid: 'owner-1' }] };
          }
          if (sql.startsWith('UPDATE requests SET')) {
            status = params[0];
            return {
              rows: [{
                id: 'req-1', type: 'pass', category: 'guest', status,
                created_by_uid: 'owner-1', created_by_name: 'Иванов', created_by_role: 'owner',
                created_by_apt: null, visitor_name: null, visitor_phone: null,
                car_plate: null, comment: '', pass_duration: 'once',
                valid_until: null, scheduled_for: null, arrived_at: null, photos: [],
                created_at: new Date(), updated_at: new Date(),
              }],
            };
          }
          if (sql.startsWith('INSERT INTO request_history')) return {};
          throw new Error(`Unexpected SQL in test: ${sql}`);
        }),
        release: jest.fn(),
      };
      return client;
    };

    db.pool.connect
      .mockResolvedValueOnce(makeClient())
      .mockResolvedValueOnce(makeClient());

    const patch = { status: 'cancelled', historyLabel: 'cancel' };
    const [first, second] = await Promise.allSettled([
      RequestsService.update(ownerUser, 'req-1', patch),
      RequestsService.update(ownerUser, 'req-1', patch),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect(second.reason).toMatchObject({
      message: expect.stringContaining("cannot transition status from 'cancelled' to 'cancelled'"),
      status: 403,
    });
  });
});

// ─── ServiceError ─────────────────────────────────────────────────────────────

test('ServiceError имеет корректный status', () => {
  const err = new ServiceError('test', 403);
  expect(err.status).toBe(403);
  expect(err.message).toBe('test');
  expect(err instanceof Error).toBe(true);
});
