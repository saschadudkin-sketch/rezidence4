'use strict';

const idempotency = require('../middleware/idempotency');

jest.mock('../lib/redisClient', () => ({
  getRedis: jest.fn(() => null),
}));

function createRes() {
  return {
    statusCode: 200,
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

describe('idempotency middleware', () => {
  test('passes through when Idempotency-Key is missing', async () => {
    const req = { headers: {}, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn();

    await idempotency(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  test('returns 400 for invalid key', async () => {
    const req = { headers: { 'idempotency-key': 'x'.repeat(257) }, user: { uid: 'u1' } };
    const res = createRes();
    const next = jest.fn();

    await idempotency(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.body).toEqual({ error: 'Idempotency-Key must be a string ≤ 256 chars' });
    expect(next).not.toHaveBeenCalled();
  });

  test('replays cached successful response for the same user/key', async () => {
    const key = 'idem-1';
    const req1 = { headers: { 'idempotency-key': key }, user: { uid: 'u1' } };
    const res1 = createRes();
    const next1 = jest.fn(() => {
      res1.statusCode = 201;
      res1.json({ ok: true, id: 'r1' });
    });

    await idempotency(req1, res1, next1);
    next1();

    const req2 = { headers: { 'idempotency-key': key }, user: { uid: 'u1' } };
    const res2 = createRes();
    const next2 = jest.fn();
    await idempotency(req2, res2, next2);

    expect(res2.status).toHaveBeenCalledWith(201);
    expect(res2.body).toEqual({ ok: true, id: 'r1' });
    expect(next2).not.toHaveBeenCalled();
  });

  test('does not cache failed responses', async () => {
    const key = 'idem-err';
    const req1 = { headers: { 'idempotency-key': key }, user: { uid: 'u1' } };
    const res1 = createRes();
    const next1 = jest.fn(() => {
      res1.statusCode = 503;
      res1.json({ error: 'temporary' });
    });

    await idempotency(req1, res1, next1);
    next1();

    const req2 = { headers: { 'idempotency-key': key }, user: { uid: 'u1' } };
    const res2 = createRes();
    const next2 = jest.fn();
    await idempotency(req2, res2, next2);

    expect(next2).toHaveBeenCalled();
  });
});
