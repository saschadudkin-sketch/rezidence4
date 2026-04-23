'use strict';

// Тесты notificationsOutboxRetentionSweep — Spec: notifications-outbox-spec.md §2.
//
// Ожидания:
//   1. Sweep делает ДВА DELETE'а (sent + dead) с правильными параметрами.
//   2. Batch LIMIT параметр = 500 (NOTIFICATIONS_OUTBOX_RETENTION_BATCH).
//   3. Env-gate: ретеншен = 0 пропускает соответствующий DELETE (но не
//      обе — если оба 0, функция не падает).
//   4. Log'аются rowCount'ы в combined info-message.
//   5. Failure одного DELETE'а не ломает второй (independent try/catch).

jest.mock('../logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  fatal: jest.fn(),
}));

const logger = require('../logger');

describe('notificationsOutboxRetentionSweep', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Очистим env перед каждым тестом чтобы jest.isolateModules подхватил
    // свежие значения.
    delete process.env.NOTIFICATIONS_OUTBOX_SENT_RETENTION_DAYS;
    delete process.env.NOTIFICATIONS_OUTBOX_DEAD_RETENTION_DAYS;
  });

  test('выполняет DELETE для sent и dead со стандартными retention 30/90 дней', async () => {
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = {
        query: jest.fn(async (sql, params) => {
          if (/status = 'sent'/.test(sql)) {
            // sent retention = 30, batch = 500
            expect(params).toEqual(['30', 500]);
            return { rows: [], rowCount: 4 };
          }
          if (/status = 'dead'/.test(sql)) {
            expect(params).toEqual(['90', 500]);
            return { rows: [], rowCount: 7 };
          }
          return { rows: [], rowCount: 0 };
        }),
      };

      await notificationsOutboxRetentionSweep(db, { slug: 'prop' });

      // Дважды query: один по sent, один по dead.
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          sentDeleted: 4,
          deadDeleted: 7,
          sentRetentionDays: 30,
          deadRetentionDays: 90,
          property: 'prop',
        }),
        expect.stringContaining('[outbox-retention]'),
      );
    });
  });

  test('не логирует info при нулевом rowCount обоих DELETE-ов', async () => {
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = {
        query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
      };

      await notificationsOutboxRetentionSweep(db, null);

      expect(db.query).toHaveBeenCalledTimes(2);
      expect(logger.info).not.toHaveBeenCalled();
    });
  });

  test('использует кастомные retention из env', async () => {
    process.env.NOTIFICATIONS_OUTBOX_SENT_RETENTION_DAYS = '7';
    process.env.NOTIFICATIONS_OUTBOX_DEAD_RETENTION_DAYS = '45';
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = {
        query: jest.fn(async (sql, params) => {
          if (/status = 'sent'/.test(sql)) {
            expect(params).toEqual(['7', 500]);
          }
          if (/status = 'dead'/.test(sql)) {
            expect(params).toEqual(['45', 500]);
          }
          return { rows: [], rowCount: 0 };
        }),
      };
      await notificationsOutboxRetentionSweep(db, null);
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });

  test('пропускает sent sweep при NOTIFICATIONS_OUTBOX_SENT_RETENTION_DAYS=0', async () => {
    process.env.NOTIFICATIONS_OUTBOX_SENT_RETENTION_DAYS = '0';
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const queries = [];
      const db = {
        query: jest.fn(async (sql) => {
          queries.push(sql);
          return { rows: [], rowCount: 0 };
        }),
      };
      await notificationsOutboxRetentionSweep(db, null);
      // Только один query — для 'dead'.
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(queries[0]).toMatch(/status = 'dead'/);
    });
  });

  test('пропускает dead sweep при NOTIFICATIONS_OUTBOX_DEAD_RETENTION_DAYS=0', async () => {
    process.env.NOTIFICATIONS_OUTBOX_DEAD_RETENTION_DAYS = '0';
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const queries = [];
      const db = {
        query: jest.fn(async (sql) => {
          queries.push(sql);
          return { rows: [], rowCount: 0 };
        }),
      };
      await notificationsOutboxRetentionSweep(db, null);
      expect(db.query).toHaveBeenCalledTimes(1);
      expect(queries[0]).toMatch(/status = 'sent'/);
    });
  });

  test('полностью отключается при обоих retention=0', async () => {
    process.env.NOTIFICATIONS_OUTBOX_SENT_RETENTION_DAYS = '0';
    process.env.NOTIFICATIONS_OUTBOX_DEAD_RETENTION_DAYS = '0';
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
      await notificationsOutboxRetentionSweep(db, null);
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  test('failure sent sweep не мешает dead sweep', async () => {
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = {
        query: jest.fn(async (sql) => {
          if (/status = 'sent'/.test(sql)) {
            throw new Error('sent pool gone');
          }
          return { rows: [], rowCount: 3 };
        }),
      };
      // Не должна throw'ать.
      await expect(notificationsOutboxRetentionSweep(db, { slug: 'x' }))
        .resolves.toBeUndefined();
      // sent (fail) + dead (ok) = 2 вызова.
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ property: 'x' }),
        expect.stringContaining('[outbox-retention] sent sweep failed'),
      );
      // Info лог всё равно пишется (deadDeleted=3 > 0).
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ sentDeleted: 0, deadDeleted: 3 }),
        expect.any(String),
      );
    });
  });

  test('failure dead sweep логируется, sent результат сохраняется', async () => {
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = {
        query: jest.fn(async (sql) => {
          if (/status = 'dead'/.test(sql)) {
            throw new Error('dead pool gone');
          }
          return { rows: [], rowCount: 2 };
        }),
      };
      await expect(notificationsOutboxRetentionSweep(db, null))
        .resolves.toBeUndefined();
      expect(db.query).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Object),
        expect.stringContaining('[outbox-retention] dead sweep failed'),
      );
    });
  });

  test('SQL targeting: sent WHERE sent_at, dead WHERE COALESCE(last_attempted_at, created_at)', async () => {
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      let sentSql = '';
      let deadSql = '';
      const db = {
        query: jest.fn(async (sql) => {
          if (/status = 'sent'/.test(sql)) sentSql = sql;
          if (/status = 'dead'/.test(sql)) deadSql = sql;
          return { rows: [], rowCount: 0 };
        }),
      };
      await notificationsOutboxRetentionSweep(db, null);

      // sent использует sent_at (когда был реально отправлен).
      expect(sentSql).toMatch(/sent_at < NOW\(\) - \(\$1 \|\| ' days'\)::INTERVAL/);
      // dead использует COALESCE last_attempted_at → created_at (защита от
      // теоретических dead без last_attempted_at).
      expect(deadSql).toMatch(/COALESCE\(last_attempted_at, created_at\)/);
    });
  });

  test('batch LIMIT=500 передаётся во ВТОРОЙ параметр', async () => {
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = {
        query: jest.fn(async (sql, params) => {
          expect(params[1]).toBe(500);
          return { rows: [], rowCount: 0 };
        }),
      };
      await notificationsOutboxRetentionSweep(db, null);
      expect(db.query).toHaveBeenCalledTimes(2);
    });
  });

  test('при NaN retention из env (случай "abc") функция no-op', async () => {
    process.env.NOTIFICATIONS_OUTBOX_SENT_RETENTION_DAYS = 'abc';
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const db = { query: jest.fn(async () => ({ rows: [], rowCount: 0 })) };
      await notificationsOutboxRetentionSweep(db, null);
      // NaN !== finite → early-return без query.
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  test('DELETE использует id IN (SELECT... LIMIT) паттерн, НЕ DELETE ... LIMIT', async () => {
    // PostgreSQL не поддерживает LIMIT в DELETE — проверяем, что SQL
    // использует CTE/subquery паттерн, а не `DELETE ... LIMIT`.
    jest.isolateModules(async () => {
      const { notificationsOutboxRetentionSweep } = require('../server/runtimeJobs');
      const queries = [];
      const db = {
        query: jest.fn(async (sql) => {
          queries.push(sql);
          return { rows: [], rowCount: 0 };
        }),
      };
      await notificationsOutboxRetentionSweep(db, null);
      for (const q of queries) {
        expect(q).toMatch(/DELETE FROM notifications_outbox\s+WHERE id IN \(/);
        // И LIMIT внутри subquery, а не в конце DELETE.
        expect(q).not.toMatch(/DELETE FROM notifications_outbox\s+WHERE .+\bLIMIT\b/);
      }
    });
  });
});
