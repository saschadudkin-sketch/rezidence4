'use strict';

const express = require('express');
const { getPlatformDb } = require('../../db');
const platformAuth = require('../../middleware/platformAuth');

const router = express.Router();
router.use(platformAuth);

// GET /platform/api/v1/stats
router.get('/', async (req, res, next) => {
  try {
    const platformDb = getPlatformDb();

    // Property totals
    const { rows: totalsRows } = await platformDb.query(
      `SELECT
         COUNT(*)                                    AS total,
         COUNT(*) FILTER (WHERE is_active = true)   AS active,
         COUNT(*) FILTER (WHERE is_active = false)  AS disabled
       FROM properties`,
    );

    const totals = {
      total:    Number(totalsRows[0].total),
      active:   Number(totalsRows[0].active),
      disabled: Number(totalsRows[0].disabled),
    };

    // Count by plan
    const { rows: planRows } = await platformDb.query(
      `SELECT plan, COUNT(*) AS count
       FROM properties
       GROUP BY plan
       ORDER BY plan`,
    );

    const byPlan = {};
    for (const row of planRows) {
      byPlan[row.plan] = Number(row.count);
    }

    // Last 20 audit log entries with admin name
    const { rows: recentAudit } = await platformDb.query(
      `SELECT pal.*, pa.name AS admin_name
       FROM platform_audit_log pal
       LEFT JOIN platform_admins pa ON pa.id = pal.admin_id
       ORDER BY pal.created_at DESC
       LIMIT 20`,
    );

    return res.json({ totals, byPlan, recentAudit });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
