'use strict';

// platform-v1 pagination helper — `limit`/`offset` query params для list endpoints.
//
// Audit (раунд 2, API contract agent) пометил «no pagination — LIMIT 500
// hardcoded» как scalability gap. Этот модуль — общий парсер, который v1
// routes используют вместо своих собственных констант.
//
// Стратегия: offset-based pagination (не cursor) — простая, совместимая
// с существующим контрактом list endpoints (плоский массив + опциональный
// total). Cursor-based — будущая итерация когда количество строк станет
// проблемой для offset.
//
// API:
//   const { limit, offset } = parsePaginationParams(req.query);
//   const sql = `SELECT ... ORDER BY created_at DESC LIMIT $1 OFFSET $2`;
//   const { rows } = await db.query(sql, [limit, offset]);
//   res.json({ items: rows, page: { limit, offset, hasMore: rows.length === limit } });
//
// Параметры:
//   query.limit  — integer, 1..MAX_LIMIT (default DEFAULT_LIMIT)
//   query.offset — integer, 0+      (default 0)
//
// Возвращает: { limit: number, offset: number }.  Бросает RangeError если
// query содержит невалидные значения (роутер должен ловить и возвращать 400).

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_OFFSET = 100_000; // защитный потолок: за пределами полезнее cursor

function parseIntStrict(raw, fieldName) {
  if (raw === undefined || raw === null || raw === '') return null;
  const str = String(raw).trim();
  if (!/^-?\d+$/.test(str)) {
    throw new RangeError(`Invalid ${fieldName}: expected integer, got "${str}"`);
  }
  const num = parseInt(str, 10);
  if (!Number.isFinite(num)) {
    throw new RangeError(`Invalid ${fieldName}: not a finite number`);
  }
  return num;
}

function parsePaginationParams(query) {
  const rawLimit = parseIntStrict(query?.limit, 'limit');
  const rawOffset = parseIntStrict(query?.offset, 'offset');

  const limit = rawLimit ?? DEFAULT_LIMIT;
  if (limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError(`Invalid limit: must be 1..${MAX_LIMIT}, got ${limit}`);
  }

  const offset = rawOffset ?? 0;
  if (offset < 0 || offset > MAX_OFFSET) {
    throw new RangeError(`Invalid offset: must be 0..${MAX_OFFSET}, got ${offset}`);
  }

  return { limit, offset };
}

// Helper для роутеров — вернуть стандартизированный pagination meta-блок.
// hasMore вычисляется по факту: если вернулось ровно limit строк — возможно,
// есть ещё.  Это дешевле, чем второй COUNT(*) запрос, и достаточно для
// клиентских "Load more" кнопок.
function buildPageMeta({ limit, offset, returnedCount }) {
  return {
    limit,
    offset,
    hasMore: returnedCount === limit,
  };
}

module.exports = {
  parsePaginationParams,
  buildPageMeta,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OFFSET,
};
