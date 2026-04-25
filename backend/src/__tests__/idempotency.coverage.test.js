'use strict';

// Coverage tests для idempotency.js — Redis path (lines 42-47, 62) и
// различные branches не покрытые в основном idempotency.test.js (тот
// тестирует только memory-cache fallback).

const mockRedis = {
  get: jest.fn(),
  setex: jest.fn().mockResolvedValue('OK'),
};

jest.mock('../lib/redisClient', () => ({
  getRedis: jest.fn(() => mockRedis),
}));

const idempotency = require('../middleware/idempotency');

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    json: jest.fn(function json(body) {
      this.body = body;
      return this;
    }),
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
  };
}

beforeEach(() => {
  mockRedis.get.mockReset();
  mockRedis.setex.mockReset().mockResolvedValue('OK');
});

describe('idempotency — Redis path coverage', () => {
  test('Redis cache hit: replays cached response without calling next()', async () => {
    mockRedis.get.mockResolvedValueOnce(JSON.stringify({
      status: 201,
      body: { ok: true, id: 'cached-id' },
    }));

    const req = { headers: { 'idempotency-key': 'k1' }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn();

    await idempotency(req, res, next);

    expect(mockRedis.get).toHaveBeenCalledWith('idem:u1:k1');
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.body).toEqual({ ok: true, id: 'cached-id' });
    expect(next).not.toHaveBeenCalled();
  });

  test('Redis cache miss: passes through to next(), then setex on 2xx', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const req = { headers: { 'idempotency-key': 'k2' }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn(() => {
      // Симуляция handler'а: status + json
      res.statusCode = 201;
      res.json({ ok: true, id: 'new-id' });
    });

    await idempotency(req, res, next);
    // idempotency вызвает next() внутри await — handler simulator уже отработал
    // и setex закеширован.  Не нужен повторный next().

    expect(mockRedis.get).toHaveBeenCalledWith('idem:u1:k2');
    expect(next).toHaveBeenCalled();
    // setex должен быть вызван ровно один раз (2xx response cached)
    expect(mockRedis.setex).toHaveBeenCalledTimes(1);
    expect(mockRedis.setex.mock.calls[0][0]).toBe('idem:u1:k2');
    expect(mockRedis.setex.mock.calls[0][1]).toBe(86400); // TTL_SECONDS
    const cached = JSON.parse(mockRedis.setex.mock.calls[0][2]);
    expect(cached.status).toBe(201);
    expect(cached.body).toEqual({ ok: true, id: 'new-id' });
  });

  test('Redis cache miss: 4xx response NOT cached', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const req = { headers: { 'idempotency-key': 'k3' }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn(() => {
      res.statusCode = 400;
      res.json({ error: 'bad request' });
    });

    await idempotency(req, res, next);
    next();

    expect(mockRedis.setex).not.toHaveBeenCalled();
  });

  test('Redis cache miss: 5xx response NOT cached', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const req = { headers: { 'idempotency-key': 'k4' }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn(() => {
      res.statusCode = 503;
      res.json({ error: 'unavailable' });
    });

    await idempotency(req, res, next);
    next();

    expect(mockRedis.setex).not.toHaveBeenCalled();
  });

  test('Redis throws on get → fall through to next() (cache miss path)', async () => {
    mockRedis.get.mockRejectedValueOnce(new Error('redis down'));

    const req = { headers: { 'idempotency-key': 'k5' }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn();

    await idempotency(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('Redis setex throws → не блокирует response (.catch handler)', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockRedis.setex.mockRejectedValueOnce(new Error('redis disconnect'));

    const req = { headers: { 'idempotency-key': 'k6' }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn(() => {
      res.statusCode = 200;
      res.json({ ok: true });
    });

    // Не должно бросать — setex.catch(() => {}) обрабатывает
    await expect((async () => {
      await idempotency(req, res, next);
      next();
    })()).resolves.not.toThrow();
  });

  test('uid scope isolation: один и тот же key для двух разных uid НЕ конфликтует', async () => {
    mockRedis.get.mockResolvedValue(null);

    const req1 = { headers: { 'idempotency-key': 'shared-key' }, user: { uid: 'user-A' } };
    const res1 = createRes();
    const next1 = jest.fn(() => {
      res1.statusCode = 200;
      res1.json({ owner: 'A' });
    });
    await idempotency(req1, res1, next1);
    next1();

    const req2 = { headers: { 'idempotency-key': 'shared-key' }, user: { uid: 'user-B' } };
    const res2 = createRes();
    const next2 = jest.fn();
    await idempotency(req2, res2, next2);

    // Должен быть вызван с user-B scope, не вернуть кешированный ответ user-A.
    expect(mockRedis.get.mock.calls[0][0]).toBe('idem:user-A:shared-key');
    expect(mockRedis.get.mock.calls[1][0]).toBe('idem:user-B:shared-key');
  });

  test('anonymous request (нет req.user.uid) использует scope "anon"', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const req = { headers: { 'idempotency-key': 'k7' } }; // no user
    const res = createRes();
    const next = jest.fn();

    await idempotency(req, res, next);

    expect(mockRedis.get).toHaveBeenCalledWith('idem:anon:k7');
  });
});
