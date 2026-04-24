'use strict';

// Shared fixtures для platform-v1 integration e2e тестов.
// Используется в *.e2e.integration.test.js под backend/src/v1/**/__tests__/.
//
// Все helper'ы — идемпотентны и изолированы per-property_id:
//   * seedFixture() создаёт новый gen_random_uuid() property_id на каждый вызов
//   * cleanupFixture(propertyId) удаляет строго то, что было создано (фильтр
//     по property_id) — параллельные тесты в одной БД безопасны
//   * applyV1Migrations() использует отдельную таблицу schema_migrations и
//     IF NOT EXISTS guards из миграций — повторный запуск бесплатный
//
// Зачем вынесено:
//   Сейчас этим пользуются announcements.e2e + packages.e2e.  Когда появится
//   3-й e2e файл (documents_v2?), просто require('./_fixtures.js') — никакого
//   copy-paste больше.  Underscore-префикс исключает файл из jest test
//   discovery (jest не трактует `_fixtures.js` как test file; паттерн
//   `__tests__/**/*.test.js` в package.json / дефолтный jest — проверять
//   на случай расширения testMatch).

const { V1_PROPERTY_MIGRATIONS } = require('../../migrations');

/**
 * applyV1Migrations — идемпотентно применяет V1_PROPERTY_MIGRATIONS на pool.
 * Использует отдельную таблицу `schema_migrations` (не трогает legacy
 * MIGRATIONS из основного backend — те для single-tenant схемы).
 *
 * Требует `pgcrypto` extension заранее (gen_random_uuid()) — вызывающий
 * тест сам должен сделать `CREATE EXTENSION IF NOT EXISTS pgcrypto`.
 */
async function applyV1Migrations(pool) {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id     TEXT PRIMARY KEY,
        run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const m of V1_PROPERTY_MIGRATIONS) {
      const { rowCount } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE id = $1',
        [m.id],
      );
      if (rowCount) continue;
      await client.query('BEGIN');
      try {
        await m.up(client);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${m.id} failed: ${err.message}`);
      }
    }
  } finally {
    client.release();
  }
}

/**
 * seedFixture — минимальная цепочка данных для e2e теста:
 *   property_id (UUID, не FK — propertyDB не содержит properties-таблицы)
 *   → building → entrance → unit → N residents → 1 staff_users
 *
 * Все rows прикреплены к одной property_id, чтобы cleanupFixture мог
 * удалить их одним фильтром.  Тест не транзакционен целиком — публикация
 * / pickup сами открывают транзакцию с SELECT FOR UPDATE.
 *
 * @param {Pool} pool
 * @param {Object}  [opts]
 * @param {number}  [opts.residentCount=1]
 * @param {string}  [opts.staffRole='property_admin']  — valid: 'security',
 *                  'concierge', 'technician', 'property_admin' (см. migration 005).
 * @returns {Promise<{propertyId, buildingId, entranceId, unitId, staffId, residentIds: string[]}>}
 */
async function seedFixture(pool, opts = {}) {
  const { residentCount = 1, staffRole = 'property_admin' } = opts;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [{ pid }] } = await client.query(`SELECT gen_random_uuid() AS pid`);

    const { rows: [building] } = await client.query(
      `INSERT INTO buildings (property_id, name) VALUES ($1, 'E2E Building') RETURNING id`,
      [pid],
    );
    const { rows: [entrance] } = await client.query(
      `INSERT INTO entrances (building_id, name) VALUES ($1, 'E2E Entrance') RETURNING id`,
      [building.id],
    );
    const { rows: [unit] } = await client.query(
      `INSERT INTO units (property_id, building_id, entrance_id, unit_number)
       VALUES ($1, $2, $3, '1')
       RETURNING id`,
      [pid, building.id, entrance.id],
    );
    const { rows: [staff] } = await client.query(
      `INSERT INTO staff_users (property_id, full_name, email, role)
       VALUES ($1, 'E2E Staff',
               'e2e-staff-' || substr($1::text, 1, 8) || '@test.local', $2)
       RETURNING id`,
      [pid, staffRole],
    );

    const residentIds = [];
    for (let i = 0; i < residentCount; i++) {
      const { rows: [r] } = await client.query(
        `INSERT INTO residents (property_id, unit_id, full_name, phone, is_active)
         VALUES ($1, $2, $3, $4, true)
         RETURNING id`,
        [pid, unit.id, `Resident ${i}`, `+79000000${String(i).padStart(3, '0')}`],
      );
      residentIds.push(r.id);
    }

    await client.query('COMMIT');
    return {
      propertyId: pid,
      buildingId: building.id,
      entranceId: entrance.id,
      unitId: unit.id,
      staffId: staff.id,
      residentIds,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * cleanupFixture — удаляет всё, что создал seedFixture + side effects
 * (outbox rows, log rows, announcements_v2, packages_v2, documents_v2).
 * Порядок строго от листьев к ссылочным сущностям из-за FK ON DELETE RESTRICT.
 *
 * Unified для announcements/packages/documents/… — delete'ы по not-existing
 * таблицам просто no-op (TRUNCATE WHERE never returns rows).
 */
async function cleanupFixture(pool, propertyId) {
  // log_v2 → outbox (FK outbox_id)
  await pool.query(
    `DELETE FROM notification_log_v2
      WHERE outbox_id IN (
        SELECT id FROM notifications_outbox WHERE property_id = $1
      )`,
    [propertyId],
  );
  await pool.query(`DELETE FROM notifications_outbox WHERE property_id = $1`, [propertyId]);
  // document_versions → documents_v2 (FK document_id ON DELETE CASCADE,
  // но мы всё равно чистим явно — быстрее чем cascade на больших seed).
  await pool.query(
    `DELETE FROM document_versions
      WHERE document_id IN (SELECT id FROM documents_v2 WHERE property_id = $1)`,
    [propertyId],
  );
  await pool.query(`DELETE FROM documents_v2 WHERE property_id = $1`, [propertyId]);
  // Entity tables that reference residents/staff/units → чистим ДО них.
  await pool.query(`DELETE FROM packages_v2 WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM announcements_v2 WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM residents WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM units WHERE property_id = $1`, [propertyId]);
  await pool.query(
    `DELETE FROM entrances
      WHERE building_id IN (SELECT id FROM buildings WHERE property_id = $1)`,
    [propertyId],
  );
  await pool.query(`DELETE FROM buildings WHERE property_id = $1`, [propertyId]);
  await pool.query(`DELETE FROM staff_users WHERE property_id = $1`, [propertyId]);
}

module.exports = {
  applyV1Migrations,
  seedFixture,
  cleanupFixture,
};
