/**
 * shared/api/passesApi.js — API для пропусков и журнала посещений.
 * Облачный realtime-провайдер убран. В demo-режиме — localStorage.
 * В production — данные идут через backendProvider → Node.js backend.
 *
 * Исправлено: module-level mutable arrays заменены на фабрику состояния.
 * Каждый вызов createPassesApiState() возвращает независимый экземпляр —
 * утечки между тестами исключены без костыля __resetPassesApiDemoState.
 */

import { validatePassByRules } from '../../domain/passValidation';
import { isLiveMode as _isLive } from '../../config/runtimeMode';
import type { VisitLogPage } from '../../services/http/visitLogs';

const DEMO_VISIT_LOGS_KEY = 'residenze_demo_visit_logs_v1';

// ─── Фабрика состояния (вместо module-level mutable arrays) ──────────────────
function createPassesApiState() {
  let passes    = [];
  let visitLogs = [];
  // FIX [BUG]: Date.now() коллизия — два визита в одну миллисекунду получали одинаковый id
  let _idCounter = 0;
  const nextId = (prefix) => `${prefix}_${Date.now()}_${++_idCounter}`;

  function loadVisitLogs() {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(DEMO_VISIT_LOGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) visitLogs = parsed;
    } catch { /* ignore */ }
  }

  function saveVisitLogs() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(DEMO_VISIT_LOGS_KEY, JSON.stringify(visitLogs));
    } catch { /* ignore */ }
  }

  function makeDemoLogs() {
    const now = Date.now();
    const h = (n) => new Date(now - n * 3600000).toISOString();
    return [
      { id: 'v_demo_1', userId: 'u1', requestId: 'req_demo_1', timestamp: h(1),
        result: 'allowed', reason: 'ok', actorName: 'Охрана', actorRole: 'security',
        visitorName: 'Дмитрий Орлов', category: 'guest',
        createdByApt: '12', createdByName: 'Михаил Волков', createdByUid: 'u1',
        requestSnapshot: { category: 'guest', visitorName: 'Дмитрий Орлов', passDuration: 'once' } },
      { id: 'v_demo_2', userId: 'u1', requestId: 'req_demo_2', timestamp: h(3),
        result: 'allowed', reason: 'ok', actorName: 'Охрана', actorRole: 'security',
        visitorName: null, category: 'taxi', carPlate: 'А777ВВ77',
        createdByApt: '12', createdByName: 'Михаил Волков', createdByUid: 'u1',
        requestSnapshot: { category: 'taxi', carPlate: 'А777ВВ77', passDuration: 'once' } },
      { id: 'v_demo_3', userId: 'u2', requestId: 'req_demo_3', timestamp: h(5),
        result: 'denied', reason: 'blacklisted', actorName: 'Система', actorRole: 'security',
        visitorName: 'Неизвестный', category: 'guest',
        createdByApt: '34', createdByName: 'Анна Соколова', createdByUid: 'u2',
        requestSnapshot: { category: 'guest', visitorName: 'Неизвестный', passDuration: 'once' } },
      { id: 'v_demo_4', userId: 'u1', requestId: 'req_demo_4', timestamp: h(26),
        result: 'allowed', reason: 'ok', actorName: 'Охрана', actorRole: 'security',
        visitorName: 'Сантехник Иванов', category: 'master',
        createdByApt: '12', createdByName: 'Михаил Волков', createdByUid: 'u1',
        requestSnapshot: { category: 'master', visitorName: 'Сантехник Иванов', passDuration: 'once' } },
      { id: 'v_demo_5', userId: 'u2', requestId: 'req_demo_5', timestamp: h(50),
        result: 'allowed', reason: 'ok', actorName: 'Охрана', actorRole: 'security',
        visitorName: 'Курьер СДЭК', category: 'courier',
        createdByApt: '34', createdByName: 'Анна Соколова', createdByUid: 'u2',
        requestSnapshot: { category: 'courier', visitorName: 'Курьер СДЭК', passDuration: 'once' } },
      { id: 'v_demo_6', userId: 'u3', requestId: 'req_demo_6', timestamp: h(72),
        result: 'denied', reason: 'expired', actorName: 'Система', actorRole: 'security',
        visitorName: 'Рабочий бригада', category: 'team',
        createdByApt: '—', createdByName: 'Алексей Строев', createdByUid: 'u3',
        requestSnapshot: { category: 'team', visitorName: 'Рабочий бригада', passDuration: 'once' } },
    ];
  }

  // Инициализация демо-данных журнала
  loadVisitLogs();
  if (visitLogs.length === 0) visitLogs = makeDemoLogs();

  return {
    async getPasses() {
      return [...passes];
    },

    async createPass(pass) {
      const payload = {
        ...pass,
        id: pass.id || nextId('p'),
        createdAt: pass.createdAt || new Date().toISOString(),
      };
      passes = [payload, ...passes];
      return payload;
    },

    async validatePass(passPayload, context = {}) {
      return validatePassByRules(passPayload, context);
    },

    async logVisit({ userId, timestamp = new Date().toISOString(), result, ...rest }) {
      const entry = { id: nextId('v'), userId, timestamp, result, ...rest };
      visitLogs = [entry, ...visitLogs];
      saveVisitLogs();
      return entry;
    },

    async getVisitLogs() {
      return [...visitLogs];
    },

    async clearVisitLogs() {
      visitLogs = [];
      saveVisitLogs();
    },

    // Для тестов — чистый сброс состояния без localStorage side effects
    __reset() {
      passes    = [];
      visitLogs = [];
      try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(DEMO_VISIT_LOGS_KEY);
      } catch { /* ignore */ }
    },
  };
}

// Singleton для production/demo использования
const passesApiInstance = createPassesApiState();

export const getPasses      = passesApiInstance.getPasses.bind(passesApiInstance);
export const createPass     = passesApiInstance.createPass.bind(passesApiInstance);
export const validatePass   = passesApiInstance.validatePass.bind(passesApiInstance);

// FIX [AUDIT-5 #8]: logVisit и getVisitLogs — mode-aware.
// В live mode данные отправляются на backend. В demo — in-memory.
// Без этого ВСЕ записи журнала посещений (QR-сканирование, пост охраны)
// терялись в production — попадали только в in-memory массив.

let _visitLogsProvider = null;
async function _getVisitLogsProvider() {
  if (!_visitLogsProvider) {
    const mod = await import('../../services/providers/backendProvider');
    _visitLogsProvider = mod.visitLogsProvider;
  }
  return _visitLogsProvider;
}

export async function logVisit(entry) {
  if (_isLive()) {
    const provider = await _getVisitLogsProvider();
    return provider.add(entry);
  }
  return passesApiInstance.logVisit(entry);
}

export async function getVisitLogs() {
  if (_isLive()) {
    const provider = await _getVisitLogsProvider();
    return provider.getAll();
  }
  const data = await passesApiInstance.getVisitLogs();
  return {
    data,
    total: data.length,
    page: 1,
    limit: Number.MAX_SAFE_INTEGER,
  } satisfies VisitLogPage;
}

export async function clearVisitLogs() {
  if (_isLive()) {
    const provider = await _getVisitLogsProvider();
    return provider.clear();
  }
  return passesApiInstance.clearVisitLogs();
}

// Для тестов: вместо __resetPassesApiDemoState используйте createPassesApiState()
export { createPassesApiState };
