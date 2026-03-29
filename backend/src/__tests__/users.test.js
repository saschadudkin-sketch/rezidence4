'use strict';
/**
 * __tests__/users.test.js
 * Покрывает: GET /api/users, POST /api/users, PATCH /api/users/:uid, DELETE /api/users/:uid
 * Проверяет: RBAC, валидацию, нормализацию телефонов, SEC-6 (avatar URL), уникальность телефона
 */
jest.mock('../db');
const db = require('../db');

const express      = require('express');
const cookieParser = require('cookie-parser');
const jwt          = require('jsonwebtoken');
const request      = require('supertest');

process.env.JWT_SECRET    = 'test-secret';
process.env.BACKEND_URL   = 'http://localhost:3001';

const usersRouter = require('../routes/users');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/users', usersRouter);
  return app;
}

const app = buildApp();

const mk = (payload) => jwt.sign(payload, 'test-secret', { expiresIn: '1h' });

const T_ADMIN    = mk({ uid: 'admin1', role: 'admin',    name: 'Адм' });
const T_SECURITY = mk({ uid: 'sec1',   role: 'security', name: 'Охр' });
const T_CONCIERGE= mk({ uid: 'con1',   role: 'concierge',name: 'Кон' });
const T_OWNER    = mk({ uid: 'own1',   role: 'owner',    name: 'Вла' });

const USER_ROW = {
  uid: 'u1', phone: '+79001112233', name: 'Тест Юзер',
  role: 'owner', apartment: '42', avatar: null,
};

// ─── GET /api/users ───────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('403 для owner', async () => {
    const res = await request(app)
      .get('/api/users').set('Cookie', `token=${T_OWNER}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('403 для contractor', async () => {
    const t = mk({ uid: 'c1', role: 'contractor', name: 'C' });
    const res = await request(app)
      .get('/api/users').set('Cookie', `token=${t}`);
    expect(res.status).toBe(403);
  });

  it('200 для security (staff)', async () => {
    db.query.mockResolvedValueOnce({ rows: [USER_ROW] });
    const res = await request(app)
      .get('/api/users').set('Cookie', `token=${T_SECURITY}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].uid).toBe('u1');
  });

  it('200 для concierge (staff)', async () => {
    db.query.mockResolvedValueOnce({ rows: [USER_ROW] });
    const res = await request(app)
      .get('/api/users').set('Cookie', `token=${T_CONCIERGE}`);
    expect(res.status).toBe(200);
  });

  it('200 для admin', async () => {
    db.query.mockResolvedValueOnce({ rows: [USER_ROW] });
    const res = await request(app)
      .get('/api/users').set('Cookie', `token=${T_ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('не возвращает лишних полей — только uid/phone/name/role/apartment/avatar', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, password_hash: 'SECRET', otp: '123' }] });
    const res = await request(app)
      .get('/api/users').set('Cookie', `token=${T_ADMIN}`);
    expect(res.body[0].password_hash).toBeUndefined();
    expect(res.body[0].otp).toBeUndefined();
    expect(res.body[0].uid).toBeDefined();
  });
});

// ─── POST /api/users ──────────────────────────────────────────────────────────

describe('POST /api/users', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).post('/api/users')
      .send({ phone: '+79001112233', name: 'Иван', role: 'owner' });
    expect(res.status).toBe(401);
  });

  it('403 для не-admin (security)', async () => {
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_SECURITY}`)
      .send({ phone: '+79001112233', name: 'Иван', role: 'owner' });
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('400 при отсутствии phone', async () => {
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ name: 'Иван', role: 'owner' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/phone/i);
  });

  it('400 при отсутствии name', async () => {
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '+79001112233', role: 'owner' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  it('400 при отсутствии role', async () => {
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '+79001112233', name: 'Иван' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/role/i);
  });

  it('400 при невалидной роли', async () => {
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '+79001112233', name: 'Иван', role: 'superuser' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid role/i);
  });

  it('нормализует 10-значный номер (+7 prefix)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, phone: '+79001112233' }] });
    await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '9001112233', name: 'Иван', role: 'owner' });
    const params = db.query.mock.calls[0][1];
    expect(params[1]).toBe('+79001112233');
  });

  it('нормализует 11-значный номер (+ prefix)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, phone: '+79001112233' }] });
    await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '79001112233', name: 'Иван', role: 'owner' });
    const params = db.query.mock.calls[0][1];
    expect(params[1]).toBe('+79001112233');
  });

  it('201 при успешном создании', async () => {
    db.query.mockResolvedValueOnce({ rows: [USER_ROW] });
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '+79001112233', name: 'Иван', role: 'owner', apartment: '5' });
    expect(res.status).toBe(201);
    expect(res.body.uid).toBeDefined();
    expect(res.body.name).toBe('Тест Юзер');
  });

  it('201 — uid генерируется сервером, не принимается от клиента', async () => {
    db.query.mockResolvedValueOnce({ rows: [USER_ROW] });
    await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ uid: 'client-chosen-uid', phone: '+79001112233', name: 'Иван', role: 'owner' });
    const params = db.query.mock.calls[0][1];
    expect(params[0]).not.toBe('client-chosen-uid');
    expect(typeof params[0]).toBe('string');
    expect(params[0].length).toBeGreaterThan(0);
  });

  it('409 при дублировании телефона (23505)', async () => {
    db.query.mockRejectedValueOnce({ code: '23505' });
    const res = await request(app)
      .post('/api/users').set('Cookie', `token=${T_ADMIN}`)
      .send({ phone: '+79001112233', name: 'Иван', role: 'owner' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/зарегистрирован/i);
  });
});

// ─── PATCH /api/users/:uid ────────────────────────────────────────────────────

describe('PATCH /api/users/:uid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).patch('/api/users/u1').send({ name: 'X' });
    expect(res.status).toBe(401);
  });

  it('403 если не admin и не сам пользователь', async () => {
    const t = mk({ uid: 'other', role: 'owner', name: 'O' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${t}`)
      .send({ name: 'Новое Имя' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Forbidden');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('200 пользователь редактирует сам себя (name)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, name: 'Новое Имя' }] });
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ name: 'Новое Имя' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Новое Имя');
  });

  it('200 пользователь меняет apartment', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, apartment: '55' }] });
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ apartment: '55' });
    expect(res.status).toBe(200);
    expect(res.body.apartment).toBe('55');
  });

  it('400 если нечего обновлять (пустое тело)', async () => {
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${T_ADMIN}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nothing to update/i);
  });

  it('SEC-6: 400 при javascript: URI в avatar', async () => {
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ avatar: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/avatar/i);
  });

  it('SEC-6: 400 при внешнем URL в avatar', async () => {
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ avatar: 'https://evil.com/tracker.png' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/avatar/i);
  });

  it('200 avatar null разрешён (очистка)', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, avatar: null }] });
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ avatar: null });
    expect(res.status).toBe(200);
  });

  it('200 avatar с /uploads/ URL разрешён', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, avatar: '/uploads/photo_1.jpg' }] });
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ avatar: '/uploads/photo_1.jpg' });
    expect(res.status).toBe(200);
  });

  it('200 admin меняет роль другому пользователю', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ ...USER_ROW, role: 'tenant' }] });
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${T_ADMIN}`)
      .send({ role: 'tenant' });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('tenant');
  });

  it('400 admin пытается поставить невалидную роль', async () => {
    const res = await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${T_ADMIN}`)
      .send({ role: 'god' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid role/i);
  });

  it('owner не может сам себе поменять роль', async () => {
    db.query.mockResolvedValueOnce({ rows: [USER_ROW] }); // role не меняется — поле role пропускается
    const selfToken = mk({ uid: 'u1', role: 'owner', name: 'Вла' });
    // Передаём role, но также name чтобы поля не были пустыми
    await request(app)
      .patch('/api/users/u1').set('Cookie', `token=${selfToken}`)
      .send({ name: 'Иван', role: 'admin' });
    // role игнорируется для не-admin → INSERT без role
    const sql = db.query.mock.calls[0][0];
    expect(sql).not.toMatch(/role=/);
  });

  it('404 если пользователь не найден', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .patch('/api/users/nonexistent').set('Cookie', `token=${T_ADMIN}`)
      .send({ name: 'Кто-то' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ─── DELETE /api/users/:uid ───────────────────────────────────────────────────

describe('DELETE /api/users/:uid', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app).delete('/api/users/u1');
    expect(res.status).toBe(401);
  });

  it('403 для не-admin', async () => {
    const res = await request(app)
      .delete('/api/users/u1').set('Cookie', `token=${T_SECURITY}`);
    expect(res.status).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('400 нельзя удалить самого себя', async () => {
    const res = await request(app)
      .delete('/api/users/admin1').set('Cookie', `token=${T_ADMIN}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yourself/i);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('200 успешное удаление другого пользователя', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .delete('/api/users/u1').set('Cookie', `token=${T_ADMIN}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const sql = db.query.mock.calls[0][0];
    expect(sql).toMatch(/DELETE FROM users/i);
    expect(db.query.mock.calls[0][1]).toEqual(['u1']);
  });
});
