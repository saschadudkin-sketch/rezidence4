'use strict';
/**
 * __tests__/requests.test.js
 * Тесты backend — requests routes.
 * Обновлены для поддержки:
 *   - BUG-3: матрица переходов статусов (owner не может approve)
 *   - BUG-4: withTransaction (pool.connect + client.query)
 *   - DATA-3: GET возвращает { data, total, page, limit }
 */
jest.mock('../db');
jest.mock('../sse', () => ({
  broadcastRequestUpdate: jest.fn(),
}));

const db           = require('../db');
const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const supertest    = require('supertest');

process.env.JWT_SECRET = 'test-secret';
process.env.AUTH_SKIP_ACTIVE_CHECK = '1';

const requestsRouter = require('../routes/requests');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/requests', requestsRouter);
  return app;
}

const app = buildApp();

function makeToken(payload) {
  return jwt.sign(payload, 'test-secret', { expiresIn: '1h' });
}

// Хелпер: настраивает mockClient для RequestsService.update() транзакции:
// BEGIN -> SELECT ... FOR UPDATE -> UPDATE -> (optional INSERT history) -> COMMIT
function setupUpdateTransaction({ existingRow, updatedRow, withHistory = false }) {
  db.pool.connect.mockResolvedValue(db._mockClient);
  db._mockClient.query.mockImplementation((sql) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return Promise.resolve({});
    if (String(sql).includes('SELECT id, status, created_by_uid')) {
      return Promise.resolve({ rows: existingRow ? [existingRow] : [] });
    }
    if (String(sql).startsWith('UPDATE requests SET')) {
      return Promise.resolve({ rows: updatedRow ? [updatedRow] : [] });
    }
    if (String(sql).startsWith('INSERT INTO request_history')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  if (!withHistory) return;
}

// Строка для мока результата заявки
function makeReqRow(overrides = {}) {
  return {
    id: 'req-123', type: 'pass', category: 'guest',
    status: 'pending', created_by_uid: 'user-A',
    created_by_name: 'Иванов', created_by_role: 'owner', created_by_apt: '1',
    visitor_name: 'Гость', visitor_phone: null, car_plate: null,
    comment: '', pass_duration: 'once', valid_until: null,
    scheduled_for: null, arrived_at: null, photos: [],
    created_at: new Date(), updated_at: new Date(),
    ...overrides,
  };
}

// ─── PATCH /api/requests/:id ──────────────────────────────────────────────────

describe('PATCH /api/requests/:id — доступ и переходы', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const authMw = require('../middleware/auth');
    authMw.__clearUserActiveFallbackCache?.();
  });

  it('403 когда житель пытается изменить чужую заявку', async () => {
    const token = makeToken({ uid: 'user-B', role: 'owner', name: 'Петров' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'pending', created_by_uid: 'user-A' },
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ comment: 'хочу поменять чужое' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
  });

  it('403 owner не может самоодобрить (pending → approved) — BUG-3', async () => {
    const token = makeToken({ uid: 'user-A', role: 'owner', name: 'Иванов' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'pending', created_by_uid: 'user-A' },
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ status: 'approved' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cannot transition/i);
  });

  it('200 owner отменяет свою pending-заявку (pending → cancelled)', async () => {
    const token = makeToken({ uid: 'user-A', role: 'owner', name: 'Иванов' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'pending', created_by_uid: 'user-A' },
      updatedRow: makeReqRow({ status: 'cancelled' }),
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');
  });

  it('200 охрана меняет любую заявку — ownership check не вызывается', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'pending', created_by_uid: 'user-A' },
      updatedRow: makeReqRow({ status: 'approved' }),
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ status: 'approved' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    expect(db.pool.connect).toHaveBeenCalled();
  });

  it('200 owner меняет comment своей заявки без смены статуса', async () => {
    const token = makeToken({ uid: 'user-A', role: 'owner', name: 'Иванов' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'pending', created_by_uid: 'user-A' },
      updatedRow: makeReqRow({ comment: 'новый комментарий' }),
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ comment: 'новый комментарий' });

    expect(res.status).toBe(200);
    expect(res.body.comment).toBe('новый комментарий');
  });

  it('400 when request id format is invalid', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    const res = await supertest(app)
      .patch('/api/requests/bad$id')
      .set('Cookie', `token=${token}`)
      .send({ status: 'approved' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid id format');
  });

  it('409 when expectedCurrentStatus is stale during status update', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'approved', created_by_uid: 'user-A' },
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ status: 'arrived', expectedCurrentStatus: 'pending' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REQUEST_CONFLICT');
    expect(res.body.details).toEqual({
      currentStatus: 'approved',
      expectedCurrentStatus: 'pending',
    });
  });

  it('200 admin может делать любой переход статуса', async () => {
    const token = makeToken({ uid: 'admin-1', role: 'admin', name: 'Адм' });

    setupUpdateTransaction({
      existingRow: { id: 'req-123', status: 'arrived', created_by_uid: 'user-A' },
      updatedRow: makeReqRow({ status: 'pending' }),
    });

    const res = await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ status: 'pending' });

    expect(res.status).toBe(200);
  });

  it('BUG-4: история пишется в той же транзакции что и UPDATE', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    // Следим за вызовами client.query (внутри транзакции)
    db.pool.connect.mockResolvedValue(db._mockClient);
    const clientCalls = [];
    db._mockClient.query.mockImplementation((sql) => {
      clientCalls.push(sql.trim().split(' ')[0]); // первое слово: BEGIN/UPDATE/INSERT/COMMIT
      if (sql === 'COMMIT' || sql === 'BEGIN' || sql === 'ROLLBACK')
        return Promise.resolve({});
      if (sql.startsWith('SELECT'))
        return Promise.resolve({ rows: [{ id: 'req-123', status: 'pending', created_by_uid: 'user-A' }] });
      if (sql.startsWith('UPDATE'))
        return Promise.resolve({ rows: [makeReqRow({ status: 'approved' })] });
      if (sql.startsWith('INSERT'))
        return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [] });
    });

    await supertest(app)
      .patch('/api/requests/req-123')
      .set('Cookie', `token=${token}`)
      .send({ status: 'approved', historyLabel: 'Допуск разрешён' });

    // Ожидаем: BEGIN, UPDATE, INSERT, COMMIT — всё в одном соединении
    expect(clientCalls).toContain('BEGIN');
    expect(clientCalls).toContain('UPDATE');
    expect(clientCalls).toContain('INSERT');
    expect(clientCalls).toContain('COMMIT');
    // ROLLBACK не должен был вызваться
    expect(clientCalls).not.toContain('ROLLBACK');
  });
});

// ─── POST /api/requests ───────────────────────────────────────────────────────

describe('POST /api/requests', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const authMw = require('../middleware/auth');
    authMw.__clearUserActiveFallbackCache?.();
  });

  it('400 при невалидном type', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Test' });
    const res = await supertest(app)
      .post('/api/requests')
      .set('Cookie', `token=${token}`)
      .send({ type: 'invalid', category: 'guest' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid type/);
  });

  it('400 при невалидном category', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Test' });
    const res = await supertest(app)
      .post('/api/requests')
      .set('Cookie', `token=${token}`)
      .send({ type: 'pass', category: 'hacker' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid category/);
  });

  it('201 owner может создать разовый пропуск сразу со статусом approved', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Test' });
    db.query.mockResolvedValueOnce({
      rows: [makeReqRow({ id: 'server-approved', status: 'approved', created_by_uid: 'u1' })],
    });
    const res = await supertest(app)
      .post('/api/requests')
      .set('Cookie', `token=${token}`)
      .send({ type: 'pass', category: 'guest', status: 'approved' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
  });

  it('201 contractor может создать пропуск со статусом approved', async () => {
    const token = makeToken({ uid: 'u3', role: 'contractor', name: 'Test' });
    db.query.mockResolvedValueOnce({
      rows: [makeReqRow({ id: 'contractor-approved', status: 'approved', created_by_uid: 'u3', created_by_role: 'contractor' })],
    });
    const res = await supertest(app)
      .post('/api/requests')
      .set('Cookie', `token=${token}`)
      .send({ type: 'pass', category: 'guest', status: 'approved' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('approved');
  });

  it('201 при валидных данных — id генерируется сервером (BUG-1)', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Test' });
    const now = new Date();
    db.query.mockResolvedValueOnce({
      rows: [makeReqRow({ id: 'server-uuid', status: 'approved', created_by_uid: 'u1' })],
    });

    const res = await supertest(app)
      .post('/api/requests')
      .set('Cookie', `token=${token}`)
      .send({ type: 'pass', category: 'guest', visitorName: 'Гость' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('server-uuid'); // ID из сервера
    expect(res.body.status).toBe('approved');

    // Клиентский id игнорируется — сервер передаёт uuid в INSERT
    const insertParams = db.query.mock.calls[0][1];
    expect(typeof insertParams[0]).toBe('string');
    expect(insertParams[0].length).toBeGreaterThan(0);
  });
});

// ─── GET /api/requests — DATA-3 + изоляция данных ────────────────────────────

describe('GET /api/requests — DATA-3 + изоляция', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    const authMw = require('../middleware/auth');
    authMw.__clearUserActiveFallbackCache?.();
  });

  it('житель видит только свои заявки + total в ответе', async () => {
    const token = makeToken({ uid: 'user-A', role: 'owner', name: 'Иванов' });

    // Один запрос с window COUNT(*) OVER()
    db.query.mockResolvedValueOnce({
      rows: [{ ...makeReqRow(), total_count: '1' }],
    });

    const res = await supertest(app)
      .get('/api/requests')
      .set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    // DATA-3: ответ содержит { data, total, page, limit }
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body.total).toBe(1);
    expect(Array.isArray(res.body.data)).toBe(true);

    // Запрос к БД фильтрует по owner uid
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/created_by_uid/);
  });

  it('охрана видит все заявки без фильтра по uid', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(app)
      .get('/api/requests')
      .set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/FROM requests WHERE deleted_at IS NULL/);
    expect(sql).toMatch(/LIMIT/);
  });

  it('пагинация — page=2&limit=10 правильно вычисляет offset', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(app)
      .get('/api/requests?page=2&limit=10')
      .set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(2);
    expect(res.body.limit).toBe(10);

    // OFFSET = (page-1) * limit = 10
    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe(10); // limit
    expect(params[1]).toBe(10); // offset
  });

  it('ограничивает limit до 100 и page не ниже 1', async () => {
    const token = makeToken({ uid: 'guard-1', role: 'security', name: 'Охранник' });

    db.query.mockResolvedValueOnce({ rows: [] });

    const res = await supertest(app)
      .get('/api/requests?page=-5&limit=100000')
      .set('Cookie', `token=${token}`);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(100);

    const params = db.query.mock.calls[0][1];
    expect(params[0]).toBe(100);
    expect(params[1]).toBe(0);
  });
});
