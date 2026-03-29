/**
 * seed.js — создаёт первого администратора в базе данных.
 * Запускать один раз после первого деплоя:
 *   docker compose exec backend node src/seed.js
 */
'use strict';
require('dotenv').config();

const { v4: uuid } = require('uuid');
const db = require('./db');

const ADMIN = {
  phone:     process.env.ADMIN_PHONE     || '+70000000000',
  name:      process.env.ADMIN_NAME      || 'Администратор',
  role:      'admin',
  apartment: null,
};

async function seed() {
  await db.migrate();

  const { rows } = await db.query(
    `SELECT uid FROM users WHERE phone=$1`, [ADMIN.phone],
  );

  if (rows.length) {
    console.log(`[seed] admin already exists (uid=${rows[0].uid})`);
    process.exit(0);
  }

  const { rows: inserted } = await db.query(
    `INSERT INTO users(uid, phone, name, role, apartment)
     VALUES($1,$2,$3,$4,$5) RETURNING uid`,
    [uuid(), ADMIN.phone, ADMIN.name, ADMIN.role, ADMIN.apartment],
  );

  console.log(`[seed] admin created: phone=${ADMIN.phone} uid=${inserted[0].uid}`);
  console.log(`[seed] login at: ${ADMIN.phone} → get OTP → enter code`);
  process.exit(0);
}

seed().catch(err => { console.error(err); process.exit(1); });
