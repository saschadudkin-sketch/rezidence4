// ─── Types ───────────────────────────────────────────────────────────────────

import { isAutoApprovedPass } from '../../domain/passLifecycle';

export type RequestStatus = 'pending' | 'approved' | 'accepted' | 'rejected' | 'arrived' | 'expired' | 'cancelled' | 'scheduled';
export type RequestType = 'pass' | 'tech';
export type PassDuration = 'once' | 'temporary' | 'permanent';

export interface AppRequest {
  id: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: string | Date;
  category?: string;
  createdByUid?: string;
  createdByRole?: string;
  createdByName?: string;
  createdByApt?: string;
  passDuration?: PassDuration;
  visitorName?: string;
  visitorPhone?: string | null;
  carPlate?: string;
  scheduledFor?: string | Date | null;
  validUntil?: string | Date | null;
  arrivedAt?: Date | null;
  comment?: string;
  photo?: string | null;
  photos?: string[];
  _pending?: boolean;
  _optimisticOpId?: string;
  [key: string]: unknown;
}

export interface HistoryEntry {
  at: Date | string;
  byName: string;
  byRole: string;
  action: string;
}

export interface RequestsState {
  requests: AppRequest[];
  history: Record<string, HistoryEntry[]>;
}

type RequestsAction =
  | { type: 'REQUEST_ADD'; request: AppRequest }
  | { type: 'REQUEST_UPDATE'; id: string; patch: Partial<AppRequest> }
  | { type: 'REQUEST_DELETE'; id: string }
  | { type: 'REQUEST_SET_STATUS'; id: string; status: RequestStatus }
  | { type: 'REQUEST_ARRIVE'; id: string; arrivedAt?: Date }
  | { type: 'REQUESTS_SET_ALL'; requests: AppRequest[] }
  | { type: 'REQUEST_ACTIVATE_SCHEDULED'; now?: number }
  | { type: 'HISTORY_ADD'; reqId: string; at?: Date; byName: string; byRole: string; label: string };

// ─── Начальные данные ────────────────────────────────────────────────────────
// Демо-данные вынесены в src/fixtures/demoData.js и загружаются только в demo-режиме
// через createServices.js. В production store всегда начинается пустым.

export const INITIAL_REQUESTS: AppRequest[] = [];
export const INITIAL_HISTORY: Record<string, HistoryEntry[]> = {};

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function requestsReducer(state: RequestsState, action: RequestsAction): RequestsState {
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
            return {
              ...r,
              status: isAutoApprovedPass(r.type, false) ? 'approved' : 'pending',
              scheduledFor: null,
            };
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
