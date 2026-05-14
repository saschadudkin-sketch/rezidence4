'use strict';
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { randomBytes } = require('crypto'); // moved to top — no repeated require in handler
const fileType   = require('file-type');
const sharp      = require('sharp');
const logger     = require('../logger');
const requireAuth = require('../middleware/auth');
const db         = require('../db'); // moved to top
const { registerUploadMetadata, createSignedUploadUrl, SIGN_TTL_SECONDS } = require('../services/uploadSecurity');

// ─── Image processing config ──────────────────────────────────────────────────
const MAX_DIMENSION   = 1200; // px — resize if width or height exceeds this
const WEBP_QUALITY    = 82;   // WebP quality (0-100); 82 ≈ good SSIM, ~60% smaller than JPEG

const router = express.Router();
router.use(requireAuth);

// ─── Photo quota cache ─────────────────────────────────────────────────────────
// Снижает нагрузку на агрегирующий COUNT-запрос в hot path upload.
// TTL маленький (30с), поэтому риск устаревания минимальный.
const photoCountCache = new Map(); // tenant:uid -> { count, expiresAt }
const PHOTO_COUNT_CACHE_TTL_MS = 30_000;

async function getCurrentPhotoCount(uid, queryDb = db, propertySlug = 'global') {
  const now = Date.now();
  const cacheKey = `${String(propertySlug || 'global').toLowerCase()}:${uid}`;
  const cached = photoCountCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.count;

  const countResult = await queryDb.query(
    `SELECT COALESCE(SUM(array_length(photos, 1)), 0)::int AS cnt
     FROM requests
     WHERE created_by_uid=$1 AND cardinality(photos) > 0 AND deleted_at IS NULL`,
    [uid],
  );
  const count = Number(countResult?.rows?.[0]?.cnt || 0);
  photoCountCache.set(cacheKey, { count, expiresAt: now + PHOTO_COUNT_CACHE_TTL_MS });
  return count;
}

// FIX [КРИТ-3]: UPLOAD_DIR через path.resolve — исключает path traversal
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
// FIX [AUDIT-10]: async mkdir с {recursive: true} — не бросает при уже существующей директории.
// Важно: uploadDirReady=true до завершения mkdir — крайне маловероятная race condition
// при старте (директория не существует И запрос приходит до завершения mkdir).
// На практике бэкенд принимает трафик только после healthcheck (зависимость docker-compose).
fs.promises.mkdir(UPLOAD_DIR, { recursive: true }).catch(err => {
  // recursive: true сам обрабатывает EEXIST — сюда попадают только реальные ошибки
  // (нет прав, неверный путь и т.д.)
  logger.error({ err }, '[upload] Failed to create UPLOAD_DIR — uploads disabled');
  uploadDirReady = false;
});
let uploadDirReady = true;

// Разрешённые MIME-типы изображений с их расширениями
const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
  ['image/gif',  'gif'],
]);

function normalizeUploadBody(body) {
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body && typeof body === 'object' && body.type === 'Buffer' && Array.isArray(body.data)) {
    return Buffer.from(body.data);
  }
  return null;
}

function shouldLogSharpFallback(err) {
  const message = String(err?.message || '').toLowerCase();
  if (!message) return true;
  if (message.includes('invalid input')) return false;
  if (message.includes('unsupported image format')) return false;
  if (message.includes('corrupt header')) return false;
  if (message.includes('premature end')) return false;
  return true;
}

const rawUploadBody = express.raw({
  type: () => true,
  limit: '10mb',
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf);
  },
});

// POST /api/upload/photo — raw binary body
router.post('/photo', rawUploadBody, async (req, res, next) => {
  try {
    const queryDb = req.db || db;
    if (!uploadDirReady) {
      return res.status(503).json({ error: 'Upload storage is temporarily unavailable' });
    }
    const MAX_PHOTOS_PER_USER = 200;
    const currentCount = await getCurrentPhotoCount(req.user.uid, queryDb, req.propertySlug);
    if (currentCount >= MAX_PHOTOS_PER_USER) {
      return res.status(429).json({ error: `Upload quota exceeded. Maximum ${MAX_PHOTOS_PER_USER} photos total.` });
    }

    const inputBuffer = normalizeUploadBody(req.body) || normalizeUploadBody(req.rawBody);
    if (!inputBuffer) {
      return res.status(400).json({ error: 'Empty or invalid upload body' });
    }

    // FIX [SEC-3]: валидация magic bytes — Content-Type заголовок устанавливает клиент
    // и его можно подделать (например, отправить PHP-скрипт с Content-Type: image/jpeg).
    // fromBuffer читает реальную сигнатуру файла из первых байт буфера.
    const fromBuffer = fileType.fromBuffer || fileType.fileTypeFromBuffer;
    if (typeof fromBuffer !== 'function') {
      throw new Error('file-type fromBuffer API is unavailable');
    }
    const detected = await fromBuffer(inputBuffer);

    if (!detected || !ALLOWED_TYPES.has(detected.mime)) {
      return res.status(400).json({
        error: `Недопустимый тип файла. Разрешены: ${[...ALLOWED_TYPES.keys()].join(', ')}`,
      });
    }

    // ── Sharp: resize + convert to WebP ───────────────────────────────────────
    // GIF-анимации сохраняем как есть (sharp не поддерживает animated gif → webp надёжно).
    // Остальные форматы: resize до MAX_DIMENSION + конвертация в WebP для экономии места.
    // Fallback: если sharp недоступен (native binaries), сохраняем оригинал.
    let outputBuffer;
    let outputExt;
    if (detected.mime === 'image/gif') {
      outputBuffer = inputBuffer;
      outputExt = ALLOWED_TYPES.get(detected.mime);
    } else {
      try {
        outputBuffer = await sharp(inputBuffer)
          .resize(MAX_DIMENSION, MAX_DIMENSION, {
            fit: 'inside',        // сохраняем соотношение сторон, не кропаем
            withoutEnlargement: true, // не увеличиваем маленькие изображения
          })
          .webp({ quality: WEBP_QUALITY })
          .toBuffer();
        outputExt = 'webp';
      } catch (sharpErr) {
        // Sharp failed (e.g., corrupted data, native lib issue) — save original
        if (shouldLogSharpFallback(sharpErr)) {
          logger.warn({ err: sharpErr }, '[upload] sharp resize failed, saving original');
        }
        outputBuffer = inputBuffer;
        outputExt = ALLOWED_TYPES.get(detected.mime);
      }
    }

    if (!Buffer.isBuffer(outputBuffer) || !outputExt) {
      return res.status(400).json({ error: 'Could not process uploaded image' });
    }

    const ext      = outputExt;
    const filename = `photo_${Date.now()}_${randomBytes(12).toString('hex')}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    await fs.promises.writeFile(filepath, outputBuffer);
    try {
      await registerUploadMetadata({
        ownerUid: req.user.uid,
        filename,
        mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
        byteSize: outputBuffer.byteLength,
        queryDb,
      });
    } catch (metadataErr) {
      logger.warn({ err: metadataErr, filename }, '[upload] failed to persist upload metadata');
    }

    res.json({ url: `/uploads/${filename}` });
  } catch (err) { next(err); }
});

router.post('/sign', express.json(), async (req, res) => {
  const rawFilename = String(req.body?.filename || '');
  const filename = path.basename(rawFilename);
  if (!filename) return res.status(400).json({ error: 'filename required' });

  const queryDb = req.db || db;
  const { rows } = await queryDb.query(
    `SELECT owner_uid FROM upload_objects WHERE filename=$1 LIMIT 1`,
    [filename],
  );
  const ownerUid = rows?.[0]?.owner_uid;
  const isStaff = ['admin', 'security', 'concierge'].includes(req.user?.role);
  if (!ownerUid || (!isStaff && ownerUid !== req.user?.uid)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
  const signedUrl = createSignedUploadUrl(filename, baseUrl, { propertySlug: req.propertySlug });
  return res.json({ url: signedUrl, expiresIn: SIGN_TTL_SECONDS });
});

// NOTE: Файлы отдаются через защищённый endpoint GET /uploads/:filename в index.js
// (требует аутентификации). router.use('/files', express.static(...)) убран — был публичным.

module.exports = router;
