'use strict';

const express    = require('express');
const https      = require('https');
const requireAuth = require('../middleware/auth');
const { isStaff } = require('../constants');

const router = express.Router();
router.use(requireAuth);

const VALID_TYPES = new Set(['hot_water', 'cold_water', 'electric', 'gas']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(req, res, next) {
  if (!UUID_RE.test(req.params.id || '')) {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid id format' } });
  }
  next();
}

// ─── GET /api/v1/meter-readings ───────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  try {
    const { type, year, month, apartment } = req.query;
    const db = req.db;
    const user = req.user;

    const params = [];
    const conditions = [];
    let idx = 1;

    if (!isStaff(user.role)) {
      conditions.push(`user_id = $${idx++}`);
      params.push(user.uid);
    } else if (apartment) {
      conditions.push(`apartment = $${idx++}`);
      params.push(apartment);
    }

    if (type) {
      if (!VALID_TYPES.has(type)) {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Invalid meter type' } });
      }
      conditions.push(`type = $${idx++}`);
      params.push(type);
    }
    if (year) {
      const y = Number.parseInt(year, 10);
      if (!Number.isFinite(y)) return res.status(400).json({ error: { code: 'INVALID_YEAR', message: 'Invalid year' } });
      conditions.push(`period_year = $${idx++}`);
      params.push(y);
    }
    if (month) {
      const m = Number.parseInt(month, 10);
      if (!Number.isFinite(m) || m < 1 || m > 12) {
        return res.status(400).json({ error: { code: 'INVALID_MONTH', message: 'Invalid month' } });
      }
      conditions.push(`period_month = $${idx++}`);
      params.push(m);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await db.query(
      `SELECT id, user_id, apartment, type, value, unit, photo_url, ocr_confidence,
              period_year, period_month, submitted_at, reviewed_by, reviewed_at, notes
       FROM meter_readings
       ${where}
       ORDER BY period_year DESC, period_month DESC, submitted_at DESC`,
      params,
    );

    res.json({ readings: rows });
  } catch (err) { next(err); }
});

// ─── GET /api/v1/meter-readings/history ──────────────────────────────────────
// Must be declared before /:id to avoid route shadowing.
router.get('/history', async (req, res, next) => {
  try {
    const { type } = req.query;
    const db = req.db;
    const user = req.user;

    const params = [user.uid];
    let typeClause = '';
    if (type) {
      if (!VALID_TYPES.has(type)) {
        return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Invalid meter type' } });
      }
      typeClause = `AND type = $2`;
      params.push(type);
    }

    const { rows } = await db.query(
      `SELECT type,
              period_year,
              period_month,
              value,
              LPAD(period_month::TEXT, 2, '0') AS month_padded
       FROM meter_readings
       WHERE user_id = $1 ${typeClause}
       ORDER BY period_year DESC, period_month DESC
       LIMIT 144`,
      params,
    );

    const history = rows.map(r => ({
      period: `${r.period_year}-${r.month_padded}`,
      type:   r.type,
      value:  parseFloat(r.value),
    }));

    res.json({ history });
  } catch (err) { next(err); }
});

// ─── POST /api/v1/meter-readings ─────────────────────────────────────────────
router.post('/', async (req, res, next) => {
  try {
    const { type, value, photo_url, period_year, period_month } = req.body;
    const db   = req.db;
    const user = req.user;

    if (!VALID_TYPES.has(type)) {
      return res.status(400).json({ error: { code: 'INVALID_TYPE', message: 'Invalid meter type' } });
    }
    const numValue = Number(value);
    if (!Number.isFinite(numValue) || numValue <= 0) {
      return res.status(400).json({ error: { code: 'INVALID_VALUE', message: 'value must be a positive number' } });
    }
    const pYear  = Number.parseInt(period_year, 10);
    const pMonth = Number.parseInt(period_month, 10);
    if (!Number.isFinite(pYear) || pYear < 2000 || pYear > 2100) {
      return res.status(400).json({ error: { code: 'INVALID_YEAR', message: 'Invalid period_year' } });
    }
    if (!Number.isFinite(pMonth) || pMonth < 1 || pMonth > 12) {
      return res.status(400).json({ error: { code: 'INVALID_MONTH', message: 'Invalid period_month (1-12)' } });
    }

    // Cannot submit for future periods
    const now = new Date();
    const currentYear  = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    if (pYear > currentYear || (pYear === currentYear && pMonth > currentMonth)) {
      return res.status(400).json({ error: { code: 'FUTURE_PERIOD', message: 'Cannot submit readings for future periods' } });
    }

    // apartment comes from token/user record
    const apartment = user.apartment || '';

    try {
      const { rows } = await db.query(
        `INSERT INTO meter_readings
           (user_id, apartment, type, value, photo_url, period_year, period_month)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, user_id, apartment, type, value, unit, photo_url,
                   period_year, period_month, submitted_at`,
        [user.uid, apartment, type, numValue, photo_url || null, pYear, pMonth],
      );
      return res.status(201).json({ reading: rows[0] });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        // unique_violation — already submitted for this period+type
        return res.status(409).json({ error: { code: 'ALREADY_SUBMITTED', message: 'Reading already submitted for this period' } });
      }
      throw dbErr;
    }
  } catch (err) { next(err); }
});

// ─── POST /api/v1/meter-readings/ocr-hint ────────────────────────────────────
router.post('/ocr-hint', async (req, res, next) => {
  try {
    const { photo_url } = req.body;
    if (!photo_url || typeof photo_url !== 'string') {
      return res.status(400).json({ error: { code: 'MISSING_PHOTO_URL', message: 'photo_url is required' } });
    }

    const apiKey = process.env.YANDEX_VISION_API_KEY;
    if (!apiKey) {
      return res.json({ value: null, confidence: 0, hint: 'OCR not configured' });
    }

    // Call Yandex Vision API
    const requestBody = JSON.stringify({
      folderId: process.env.YANDEX_FOLDER_ID || '',
      analyze_specs: [{
        source: { url: photo_url },
        features: [{ type: 'TEXT_DETECTION', text_detection_config: { language_codes: ['*'] } }],
      }],
    });

    const parsed = await new Promise((resolve, reject) => {
      const req2 = https.request(
        'https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Api-Key ${apiKey}`,
          },
        },
        (resp) => {
          let data = '';
          resp.on('data', (chunk) => { data += chunk; });
          resp.on('end', () => {
            try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
          });
        },
      );
      req2.on('error', reject);
      req2.write(requestBody);
      req2.end();
    });

    // Extract first numeric value from OCR text blocks
    const pages = parsed?.results?.[0]?.results?.[0]?.textDetection?.pages || [];
    let rawText = '';
    for (const page of pages) {
      for (const block of page.blocks || []) {
        for (const line of block.lines || []) {
          for (const word of line.words || []) {
            rawText += (word.text || '') + ' ';
          }
        }
      }
    }

    const match = rawText.match(/[\d]+[.,]?[\d]*/);
    if (match) {
      const numStr = match[0].replace(',', '.');
      const value = parseFloat(numStr);
      return res.json({ value: Number.isFinite(value) ? value : null, confidence: 0.7, raw: rawText.trim() });
    }
    return res.json({ value: null, confidence: 0, raw: rawText.trim() });
  } catch (err) { next(err); }
});

// ─── PATCH /api/v1/meter-readings/:id/review ─────────────────────────────────
router.patch('/:id/review', validateUuid, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Admin only' } });
    }

    const { notes } = req.body;
    const db = req.db;

    const { rows } = await db.query(
      `UPDATE meter_readings
       SET reviewed_by = $1, reviewed_at = NOW(), notes = COALESCE($2, notes)
       WHERE id = $3
       RETURNING id, user_id, apartment, type, value, unit, photo_url,
                 period_year, period_month, submitted_at, reviewed_by, reviewed_at, notes`,
      [req.user.uid, notes || null, req.params.id],
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Reading not found' } });
    }
    res.json({ reading: rows[0] });
  } catch (err) { next(err); }
});

module.exports = router;
