'use strict';
/**
 * Тесты backend — chat routes
 * Покрывает: BUG-5 (валидация reactions структуры и размера)
 */
jest.mock('../db');
jest.mock('../sse', () => ({
  broadcastChatMessage: jest.fn(),
  broadcastChatUpdate:  jest.fn(),
  broadcastChatDelete:  jest.fn(),
}));

const db = require('../db');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const request = require('supertest');

process.env.JWT_SECRET = 'test-secret';
process.env.BACKEND_URL = 'http://backend.test';
const prevAuthEnforceActive = process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK;
process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK = '0';

const chatRouter = require('../routes/chat');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/chat', chatRouter);
  return app;
}
const app = buildApp();
afterAll(() => {
  if (prevAuthEnforceActive === undefined) delete process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK;
  else process.env.AUTH_ENFORCE_ACTIVE_USER_CHECK = prevAuthEnforceActive;
});

function makeToken(payload) {
  return jwt.sign(payload, 'test-secret', { expiresIn: '1h' });
}

function expectTransactionClosed(client) {
  expect(client.query).toHaveBeenCalledWith('BEGIN');
  expect(client.query).toHaveBeenCalledWith('COMMIT');
  expect(client.release).toHaveBeenCalledTimes(1);
}

function expectTransactionRolledBack(client) {
  expect(client.query).toHaveBeenCalledWith('BEGIN');
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
}

// ─── PATCH /api/chat/messages/:id — reactions validation ─────────────────────

describe('PATCH /api/chat/messages/:id — валидация reactions', () => {
  let txClient;
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
    txClient = {
      query: jest.fn(),
      release: jest.fn(),
    };
    db.pool = { connect: jest.fn().mockResolvedValue(txClient) };
  });

  const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });

  it('400 когда reactions — массив (не объект)', async () => {
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: ['👍', '❤️'] }); // массив вместо объекта
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/plain object/i);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('400 когда reactions — строка', async () => {
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: 'invalid' });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('400 когда ключей больше 20', async () => {
    const tooMany = {};
    for (let i = 0; i < 21; i++) tooMany[`emoji${i}`] = ['u1'];
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: tooMany });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Too many/i);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('400 когда ключ длиннее 10 символов', async () => {
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { 'toolongkeyvalue': ['u1'] } }); // 15 символов
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('400 когда значение не массив', async () => {
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { '👍': 'not-an-array' } });
    expect(res.status).toBe(400);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('400 когда элемент реакции не строка', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u1' }] });
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { '👍': [123, 456] } }); // числа вместо uid-строк
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Reaction value must be \[\] or \[your_uid\]/i);
  });

  it('400 когда в реакции указан чужой uid', async () => {
    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { '👍': ['u2'] } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only add your own uid/i);
    expect(db.query).not.toHaveBeenCalled();
    expect(db.pool.connect).not.toHaveBeenCalled();
  });

  it('200 при корректных reactions', async () => {
    const now = new Date();
    txClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', reactions: { '👍': ['u2'] } }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1', uid: 'u1', name: 'Иванов', role: 'owner', text: 'hi', photo: null, reply_to: null, reactions: { '👍': ['u2', 'u1'], '❤️': ['u1'] }, edited: false, at: now }] }) // UPDATE RETURNING
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { '👍': ['u1'], '❤️': ['u1'] } });

    expect(res.status).toBe(200);
    expect(res.body.reactions).toBeDefined();
    expectTransactionClosed(txClient);
  });

  it('200 при пустом объекте reactions (удаление всех реакций)', async () => {
    const now = new Date();
    txClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', reactions: {} }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [{ id: 'msg-1', uid: 'u1', name: 'Иванов', role: 'owner', text: 'hi', photo: null, reply_to: null, reactions: {}, edited: false, at: now }] }) // UPDATE RETURNING
      .mockResolvedValueOnce(undefined); // COMMIT

    const res = await request(app)
      .patch('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`)
      .send({ reactions: {} });

    expect(res.status).toBe(200);
    expectTransactionClosed(txClient);
  });

  it('404 при отсутствии сообщения и транзакция откатывается', async () => {
    txClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE (not found)
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const res = await request(app)
      .patch('/api/chat/messages/msg-missing')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { '👍': ['u1'] } });

    expect(res.status).toBe(404);
    expectTransactionRolledBack(txClient);
  });

  it('500 при ошибке UPDATE и транзакция откатывается', async () => {
    txClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', reactions: {} }] }) // SELECT ... FOR UPDATE
      .mockRejectedValueOnce(new Error('db update failed')) // UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const res = await request(app)
      .patch('/api/chat/messages/msg-err')
      .set('Cookie', `token=${token}`)
      .send({ reactions: { '👍': ['u1'] } });

    expect(res.status).toBe(500);
    expectTransactionRolledBack(txClient);
  });

  it('400 при отсутствии полей для обновления и транзакция откатывается', async () => {
    txClient.query
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [{ uid: 'u1', reactions: {} }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const res = await request(app)
      .patch('/api/chat/messages/msg-noop')
      .set('Cookie', `token=${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Nothing to update');
    expectTransactionRolledBack(txClient);
  });
});

// ─── POST /api/chat/messages ──────────────────────────────────────────────────

describe('POST /api/chat/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
  });

  it('400 когда нет id', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ text: 'Hello' }); // без id
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id required/i);
  });

  it('201 при корректном сообщении', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const now = new Date();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'msg-new', uid: 'u1', name: 'Иванов', role: 'owner', text: 'Hello', photo: null, reply_to: null, reactions: {}, edited: false, at: now }],
    });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ id: 'msg-new', text: 'Hello' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('msg-new');
    expect(res.body.text).toBe('Hello');
  });

  it('201 когда photo — относительный /uploads URL', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const now = new Date();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'msg-photo-1', uid: 'u1', name: 'Иванов', role: 'owner', text: null, photo: '/uploads/photo_1.jpg', reply_to: null, reactions: {}, edited: false, at: now }],
    });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ id: 'msg-photo-1', photo: '/uploads/photo_1.jpg' });
    expect(res.status).toBe(201);
    expect(res.body.photo).toBe('/uploads/photo_1.jpg');
  });

  it('201 когда photo — абсолютный URL на BACKEND_URL/uploads', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const now = new Date();
    db.query.mockResolvedValueOnce({
      rows: [{ id: 'msg-photo-2', uid: 'u1', name: 'Иванов', role: 'owner', text: null, photo: 'http://backend.test/uploads/photo_2.jpg', reply_to: null, reactions: {}, edited: false, at: now }],
    });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ id: 'msg-photo-2', photo: 'http://backend.test/uploads/photo_2.jpg' });
    expect(res.status).toBe(201);
    expect(res.body.photo).toBe('http://backend.test/uploads/photo_2.jpg');
  });

  it('400 когда photo — внешний URL', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ id: 'msg-photo-bad-1', photo: 'https://evil.example/uploads/photo.jpg' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('photo must be a local upload URL');
  });

  it('400 когда photo — data: URL', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ id: 'msg-photo-bad-2', photo: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('photo must be a local upload URL');
  });

  it('400 когда photo — javascript: URL', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    const res = await request(app)
      .post('/api/chat/messages')
      .set('Cookie', `token=${token}`)
      .send({ id: 'msg-photo-bad-3', photo: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('photo must be a local upload URL');
  });
});

// ─── DELETE /api/chat/messages/:id ───────────────────────────────────────────

describe('DELETE /api/chat/messages/:id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
  });

  it('403 когда не автор и не admin', async () => {
    const token = makeToken({ uid: 'u2', role: 'owner', name: 'Петров' });
    db.query.mockResolvedValueOnce({ rows: [{ uid: 'u1' }] }); // сообщение принадлежит u1
    const res = await request(app)
      .delete('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(403);
  });

  it('200 когда автор удаляет своё сообщение', async () => {
    const token = makeToken({ uid: 'u1', role: 'owner', name: 'Иванов' });
    db.query
      .mockResolvedValueOnce({ rows: [{ uid: 'u1' }] }) // сообщение принадлежит u1
      .mockResolvedValueOnce({ rows: [] });              // DELETE
    const res = await request(app)
      .delete('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('200 когда admin удаляет чужое сообщение', async () => {
    const token = makeToken({ uid: 'admin1', role: 'admin', name: 'Админ' });
    db.query
      .mockResolvedValueOnce({ rows: [{ uid: 'u1' }] }) // чужое сообщение
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .delete('/api/chat/messages/msg-1')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/chat/messages — pagination (AUDIT-6) ───────────────────────────

describe('GET /api/chat/messages — cursor pagination (AUDIT-6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.query.mockReset();
  });
  const token = makeToken({ uid: 'u1', role: 'security', name: 'Охрана' });

  function makeRows(n) {
    return Array.from({ length: n }, (_, i) => ({
      id: `m${i + 1}`, uid: 'u1', name: 'Test', role: 'owner',
      text: `Message ${i + 1}`, photo: null, reply_to: null,
      reactions: {}, edited: false,
      at: new Date(Date.now() - i * 1000).toISOString(),
    }));
  }

  test('без параметров — возвращает { messages, hasMore }', async () => {
    db.query.mockResolvedValueOnce({ rows: makeRows(5) });
    const res = await request(app)
      .get('/api/chat/messages')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('messages');
    expect(res.body).toHaveProperty('hasMore');
    expect(Array.isArray(res.body.messages)).toBe(true);
  });

  test('hasMore=true если строк больше limit', async () => {
    // Запросили 60, вернули 61 → hasMore=true
    db.query.mockResolvedValueOnce({ rows: makeRows(61) });
    const res = await request(app)
      .get('/api/chat/messages?limit=60')
      .set('Cookie', `token=${token}`);
    expect(res.body.hasMore).toBe(true);
    expect(res.body.messages).toHaveLength(60); // лишний обрезан
  });

  test('hasMore=false если строк ≤ limit', async () => {
    db.query.mockResolvedValueOnce({ rows: makeRows(10) });
    const res = await request(app)
      .get('/api/chat/messages?limit=60')
      .set('Cookie', `token=${token}`);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.messages).toHaveLength(10);
  });

  test('с before — SQL запрос содержит подзапрос по курсору', async () => {
    db.query.mockResolvedValueOnce({ rows: makeRows(3) });
    const res = await request(app)
      .get('/api/chat/messages?before=m50')
      .set('Cookie', `token=${token}`);
    expect(res.status).toBe(200);
    // Проверяем что запрос к БД содержал before параметр
    const callArgs = db.query.mock.calls[0];
    expect(callArgs[1][0]).toBe('m50'); // первый параметр — id курсора
  });

  test('limit=100 — максимум 100 сообщений', async () => {
    db.query.mockResolvedValueOnce({ rows: makeRows(101) });
    const res = await request(app)
      .get('/api/chat/messages?limit=200') // запросили 200, но max=100
      .set('Cookie', `token=${token}`);
    expect(res.body.messages.length).toBeLessThanOrEqual(100);
  });

  test('сообщения возвращаются в хронологическом порядке (старые → новые)', async () => {
    const rows = makeRows(3); // порядок DESC из БД
    db.query.mockResolvedValueOnce({ rows });
    const res = await request(app)
      .get('/api/chat/messages')
      .set('Cookie', `token=${token}`);
    const msgs = res.body.messages;
    // .reverse() в роуте — msgs[0] должен быть старее msgs[last]
    if (msgs.length > 1) {
      expect(new Date(msgs[0].at).getTime())
        .toBeLessThanOrEqual(new Date(msgs[msgs.length - 1].at).getTime());
    }
  });
});
