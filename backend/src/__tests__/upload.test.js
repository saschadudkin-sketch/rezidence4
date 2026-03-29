'use strict';
/**
 * __tests__/upload.test.js
 * Покрывает: POST /api/upload/photo
 * Проверяет: SEC-3 (magic bytes валидация), КРИТ-3 (path traversal исключён),
 *            допустимые типы изображений, возвращаемый URL
 */

// Мокируем до импорта роутера — иначе роутер пытается создать реальную папку
jest.mock('file-type', () => ({ fromBuffer: jest.fn() }));
jest.mock('fs', () => {
  const real = jest.requireActual('fs');
  return {
    ...real,
    existsSync:   () => true,
    mkdirSync:    jest.fn(),
    promises: {
      ...real.promises,
      writeFile: jest.fn().mockResolvedValue(undefined),
    },
  };
});
jest.mock('../db');

const fileType = require('file-type');
const fs       = require('fs');

const express        = require('express');
const cookieParser   = require('cookie-parser');
const jwt            = require('jsonwebtoken');
const request        = require('supertest');

process.env.JWT_SECRET  = 'test-secret';
process.env.BACKEND_URL = 'http://backend.test';
process.env.UPLOAD_DIR  = '/tmp/test-uploads';

const uploadRouter = require('../routes/upload');

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use('/api/upload', uploadRouter);
  return app;
}

const app = buildApp();

const mk = (p) => jwt.sign(p, 'test-secret', { expiresIn: '1h' });
const T_USER = mk({ uid: 'u1', role: 'owner', name: 'Вла' });

// Буферы с реальными magic bytes (для имитации разных типов)
const FAKE_JPEG = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0]);
const FAKE_PNG  = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0, 0]);
const FAKE_WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const FAKE_GIF  = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
const FAKE_JUNK = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

// ─── POST /api/upload/photo ───────────────────────────────────────────────────

describe('POST /api/upload/photo', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 без токена', async () => {
    const res = await request(app)
      .post('/api/upload/photo')
      .set('Content-Type', 'image/jpeg')
      .send(FAKE_JPEG);
    expect(res.status).toBe(401);
    expect(fileType.fromBuffer).not.toHaveBeenCalled();
  });

  it('SEC-3: 400 при неизвестном типе файла (мусорные байты)', async () => {
    fileType.fromBuffer.mockResolvedValueOnce(null);
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .set('Content-Type', 'application/octet-stream').send(FAKE_JUNK);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/недопустимый тип файла/i);
    expect(fs.promises.writeFile).not.toHaveBeenCalled();
  });

  it('SEC-3: 400 при application/pdf (подделка Content-Type)', async () => {
    // Клиент отправляет реальный PDF, заголовок image/jpeg — не должно помочь
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'application/pdf', ext: 'pdf' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .set('Content-Type', 'image/jpeg').send(FAKE_JUNK);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/недопустимый тип файла/i);
  });

  it('SEC-3: 400 при text/html (XSS-попытка)', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'text/html', ext: 'html' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .send(Buffer.from('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
  });

  it('200 для JPEG — URL заканчивается на .jpg', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .set('Content-Type', 'image/jpeg').send(FAKE_JPEG);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.jpg$/);
    expect(res.body.url).toContain('/uploads/');
  });

  it('200 для PNG — URL заканчивается на .png', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .send(FAKE_PNG);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.png$/);
  });

  it('200 для WebP — URL заканчивается на .webp', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/webp', ext: 'webp' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .send(FAKE_WEBP);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.webp$/);
  });

  it('200 для GIF — URL заканчивается на .gif', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/gif', ext: 'gif' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .send(FAKE_GIF);
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.gif$/);
  });

  it('URL содержит BACKEND_URL из env', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .send(FAKE_JPEG);
    expect(res.body.url).toContain('http://backend.test');
  });

  it('URL содержит уникальное имя файла (содержит "photo_")', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    const res = await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .send(FAKE_JPEG);
    expect(res.body.url).toMatch(/photo_\d+_[a-z0-9]+\.jpg/);
  });

  it('файл записывается на диск (fs.writeFile вызван 1 раз)', async () => {
    fileType.fromBuffer.mockResolvedValueOnce({ mime: 'image/jpeg', ext: 'jpg' });
    await request(app)
      .post('/api/upload/photo').set('Cookie', `token=${T_USER}`)
      .set('Content-Type', 'image/jpeg').send(FAKE_JPEG);
    expect(fs.promises.writeFile).toHaveBeenCalledTimes(1);
    // writeFile вызван с буфером тела
    const [_path, body] = fs.promises.writeFile.mock.calls[0];
    expect(Buffer.isBuffer(body)).toBe(true);
  });

  it('два запроса подряд дают разные имена файлов (нет коллизий)', async () => {
    fileType.fromBuffer
      .mockResolvedValueOnce({ mime: 'image/png', ext: 'png' })
      .mockResolvedValueOnce({ mime: 'image/png', ext: 'png' });

    const [r1, r2] = await Promise.all([
      request(app).post('/api/upload/photo').set('Cookie', `token=${T_USER}`).send(FAKE_PNG),
      request(app).post('/api/upload/photo').set('Cookie', `token=${T_USER}`).send(FAKE_PNG),
    ]);

    expect(r1.body.url).not.toBe(r2.body.url);
  });
});
