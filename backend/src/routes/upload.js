'use strict';
const express    = require('express');
const path       = require('path');
const fs         = require('fs');
const { randomBytes } = require('crypto'); // moved to top — no repeated require in handler
const fileType   = require('file-type');
const logger     = require('../logger');
const requireAuth = require('../middleware/auth');
const db         = require('../db'); // moved to top

const router = express.Router();
router.use(requireAuth);

// FIX [КРИТ-3]: UPLOAD_DIR через path.resolve — исключает path traversal
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || '/app/uploads');
// FIX [AUDIT-10]: existsSync/mkdirSync блокировали event loop при старте.
// Допустимо для startup-кода, но лучше использовать async mkdir с {recursive: true}
// которая является no-op если директория уже существует.
fs.promises.mkdir(UPLOAD_DIR, { recursive: true }).catch(err => {
  // Только если это не "уже существует" — fatal
  if (err.code !== 'EEXIST') {
    logger.error('Failed to create UPLOAD_DIR', err);
    process.exit(1);
  }
});

// Разрешённые MIME-типы изображений с их расширениями
const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png',  'png'],
  ['image/webp', 'webp'],
  ['image/gif',  'gif'],
]);

// POST /api/upload/photo — raw binary body
router.post('/photo', express.raw({ type: '*/*', limit: '10mb' }), async (req, res, next) => {
  try {
    const MAX_PHOTOS_PER_USER = 200;
    const { rows: countRows } = await db.query(
      `SELECT COALESCE(SUM(array_length(photos, 1)), 0)::int AS cnt
       FROM requests
       WHERE created_by_uid=$1 AND cardinality(photos) > 0 AND deleted_at IS NULL`,
      [req.user.uid],
    );
    if (countRows[0].cnt >= MAX_PHOTOS_PER_USER) {
      return res.status(429).json({ error: `Upload quota exceeded. Maximum ${MAX_PHOTOS_PER_USER} photos total.` });
    }

    // FIX [SEC-3]: валидация magic bytes — Content-Type заголовок устанавливает клиент
    // и его можно подделать (например, отправить PHP-скрипт с Content-Type: image/jpeg).
    // fromBuffer читает реальную сигнатуру файла из первых байт буфера.
    const detected = await fileType.fromBuffer(req.body);

    if (!detected || !ALLOWED_TYPES.has(detected.mime)) {
      return res.status(400).json({
        error: `Недопустимый тип файла. Разрешены: ${[...ALLOWED_TYPES.keys()].join(', ')}`,
      });
    }

    const ext      = ALLOWED_TYPES.get(detected.mime);
    const filename = `photo_${Date.now()}_${randomBytes(12).toString('hex')}.${ext}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    await fs.promises.writeFile(filepath, req.body);

    const baseUrl = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 3001}`;
    res.json({ url: `${baseUrl}/uploads/${filename}` });
  } catch (err) { next(err); }
});

// NOTE: Файлы отдаются через защищённый endpoint GET /uploads/:filename в index.js
// (требует аутентификации). router.use('/files', express.static(...)) убран — был публичным.

module.exports = router;
