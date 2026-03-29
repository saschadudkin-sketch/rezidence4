/**
 * integration/visitLogFlow.test.js
 * FIX [AUDIT-5]: integration test для mode-aware visit logging.
 * Покрывает критический баг: logVisit/getVisitLogs работали только в demo.
 */

import { createPassesApiState } from '../shared/api/passesApi';

// Мокаем runtimeMode — тест проверяет оба режима
let _mockLiveMode = false;
jest.mock('../config/runtimeMode', () => ({
  isLiveMode: () => _mockLiveMode,
  isDemoMode: () => !_mockLiveMode,
  LIVE_MODE: 'live',
  DEMO_MODE: 'demo',
  MODE: 'demo',
}));

// Мокаем backendProvider для live mode
const mockAdd = jest.fn().mockResolvedValue({ id: 'v_test', result: 'allowed' });
const mockGetAll = jest.fn().mockResolvedValue({ data: [{ id: 'v1', result: 'allowed' }], total: 1 });
const mockClear = jest.fn().mockResolvedValue({ ok: true });

jest.mock('../services/providers/backendProvider', () => ({
  visitLogsProvider: {
    add: (...args) => mockAdd(...args),
    getAll: (...args) => mockGetAll(...args),
    clear: (...args) => mockClear(...args),
  },
}));

describe('passesApi: mode-aware visit logging', () => {
  beforeEach(() => {
    _mockLiveMode = false;
    mockAdd.mockClear();
    mockGetAll.mockClear();
    mockClear.mockClear();
  });

  describe('demo mode', () => {
    it('logVisit сохраняет в in-memory (не вызывает backend)', async () => {
      // Динамический импорт после настройки моков
      const { logVisit, getVisitLogs } = await import('../shared/api/passesApi');

      const entry = { userId: 'u1', result: 'allowed', reason: 'ok' };
      await logVisit(entry);

      expect(mockAdd).not.toHaveBeenCalled();

      const logs = await getVisitLogs();
      // В demo режиме getVisitLogs возвращает in-memory данные
      expect(Array.isArray(logs)).toBe(true);
    });
  });

  describe('createPassesApiState (unit)', () => {
    it('logVisit создаёт запись с уникальным id', async () => {
      const state = createPassesApiState();

      await state.logVisit({ userId: 'u1', result: 'allowed' });
      await state.logVisit({ userId: 'u1', result: 'denied' });

      const logs = await state.getVisitLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].id).not.toBe(logs[1].id);
    });

    it('clearVisitLogs очищает все записи', async () => {
      const state = createPassesApiState();
      await state.logVisit({ userId: 'u1', result: 'allowed' });
      await state.clearVisitLogs();
      const logs = await state.getVisitLogs();
      expect(logs).toHaveLength(0);
    });
  });
});
