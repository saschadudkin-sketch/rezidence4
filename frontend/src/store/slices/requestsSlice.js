// ─── Начальные данные ────────────────────────────────────────────────────────
// Демо-данные вынесены в src/fixtures/demoData.js и загружаются только в demo-режиме
// через createServices.js. В production store всегда начинается пустым.

export const INITIAL_REQUESTS = [];
export const INITIAL_HISTORY = {};

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function requestsReducer(state, action) {
  switch (action.type) {

    case 'REQUEST_ADD':
      // FIX [AUDIT-2 #13]: дедупликация — если заявка уже есть (пришла по SSE),
      // обновляем вместо добавления. Предотвращает дубли при optimistic update + SSE.
      if (state.requests.some(r => r.id === action.request.id)) {
        return {
          ...state,
          requests: state.requests.map(r =>
            r.id === action.request.id ? { ...r, ...action.request } : r
          ),
        };
      }
      return { ...state, requests: [action.request, ...state.requests] };

    case 'REQUEST_UPDATE':
      return {
        ...state,
        requests: state.requests.map(r =>
          r.id === action.id ? { ...r, ...action.patch } : r
        ),
      };

    case 'REQUEST_DELETE':
      return { ...state, requests: state.requests.filter(r => r.id !== action.id) };

    case 'REQUEST_SET_STATUS':
      return {
        ...state,
        requests: state.requests.map(r =>
          r.id === action.id ? { ...r, status: action.status } : r
        ),
      };

    case 'REQUEST_ARRIVE': {
      // FIX [ARCH]: now должен передаваться из экшена (чистый редьюсер).
      // action.arrivedAt обязателен; new Date() — fallback только для совместимости.
      const now = action.arrivedAt || new Date();
      return {
        ...state,
        requests: state.requests.map(r => {
          if (r.id !== action.id) return r;
          // Постоянный или временный пропуск — остаётся approved после входа
          if (r.passDuration === 'permanent' || r.passDuration === 'temporary') {
            return { ...r, arrivedAt: now };
          }
          // Разовый (или без типа) — стандартное поведение: arrived
          return { ...r, status: 'arrived', arrivedAt: now };
        }),
      };
    }

    case 'REQUESTS_SET_ALL':
      return { ...state, requests: action.requests };

    case 'REQUEST_ACTIVATE_SCHEDULED': {
      // FIX [ARCH]: чистый reducer — время приходит из экшена
      // FIX [PERF]: сравниваем числовые timestamps, не Date-объекты (O(1) vs O(n) Date alloc)
      const nowTs = action.now ?? Date.now();
      const TERMINAL = new Set(['rejected','arrived','expired','cancelled']);
      const DAY_MS = 86_400_000;
      return {
        ...state,
        requests: state.requests.map(r => {
          // Активация запланированных
          if (r.status === 'scheduled' && r.scheduledFor
              && new Date(r.scheduledFor).getTime() <= nowTs) {
            return { ...r, status: 'pending', scheduledFor: null };
          }
          // Истечение временных пропусков (validUntil истёк)
          if (r.validUntil && !TERMINAL.has(r.status)
              && new Date(r.validUntil).getTime() <= nowTs) {
            return { ...r, status: 'expired' };
          }
          // Истечение разовых пропусков через 24 часа после создания
          if (r.passDuration === 'once'
              && (r.status === 'pending' || r.status === 'approved')
              && r.createdAt
              && (nowTs - new Date(r.createdAt).getTime()) > DAY_MS) {
            return { ...r, status: 'expired' };
          }
          return r;
        }),
      };
    }

    case 'HISTORY_ADD': {
      const existing = state.history[action.reqId] || [];
      return {
        ...state,
        history: {
          ...state.history,
          [action.reqId]: [
            ...existing,
            // FIX [ARCH]: action.at должен передаваться из экшена; new Date() — fallback
            { at: action.at || new Date(), byName: action.byName, byRole: action.byRole, action: action.label },
          ],
        },
      };
    }

    default:
      return state;
  }
}
