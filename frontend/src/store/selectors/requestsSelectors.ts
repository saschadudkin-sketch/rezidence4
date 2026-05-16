import { createSelector } from 'reselect';
import { ROLES } from '../../domain/permissions';
import { getValidationReasonLabel } from '../../constants/statusPresentation';
import type { AppIconName } from '../../ui/AppIcon';
import type { AppStoreSnapshot } from '../boundedContexts/contexts';
import type { AppRequest, PassDuration, RequestStatus, RequestType } from '../slices/requestsSlice';
import type { AppUser } from '../slices/usersSlice';
import type { Car } from '../slices/garageSlice';
import type { Template, UserPerms } from '../slices/permsSlice';

const INACTIVE_STATUSES = new Set<RequestStatus>(['cancelled', 'rejected', 'expired']);
const COMPLETED_STATUSES = new Set<RequestStatus>(['arrived', 'rejected', 'expired', 'cancelled']);
const EMPTY_REQUESTS: AppRequest[] = [];
const EMPTY_USERS: Record<string, AppUser> = {};
const EMPTY_TEMPLATES: Template[] = [];
const EMPTY_PERMS: Record<string, UserPerms> = {};
const EMPTY_GARAGE: Record<string, Car[]> = {};

const selectRequests = (state: AppStoreSnapshot) => state.reqState?.requests ?? EMPTY_REQUESTS;
const selectUsers = (state: AppStoreSnapshot) => state.usersState?.users ?? EMPTY_USERS;
const selectPerms = (state: AppStoreSnapshot) => state.permsState?.perms ?? EMPTY_PERMS;
const selectGarage = (state: AppStoreSnapshot) => state.garageState?.garage ?? EMPTY_GARAGE;
const selectTemplatesForUser = (state: AppStoreSnapshot, uid: string) =>
  state.permsState?.templates?.[uid] ?? EMPTY_TEMPLATES;

function getRequestTime(request: AppRequest): number {
  const time = new Date(request.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortRequestsDesc(requests: AppRequest[]): AppRequest[] {
  return [...requests].sort((left, right) => getRequestTime(right) - getRequestTime(left));
}

function sortOperationalRequests(requests: AppRequest[]): AppRequest[] {
  const statusOrder: Partial<Record<RequestStatus, number>> = { pending: 0, scheduled: 1 };
  return requests
    .map((request) => ({
      request,
      order: statusOrder[request.status] ?? 2,
      ts: getRequestTime(request),
    }))
    .sort((left, right) => left.order !== right.order ? left.order - right.order : right.ts - left.ts)
    .map(({ request }) => request);
}

function matchesRequestQuery(req: AppRequest, query: string): boolean {
  if (!query) return true;
  return [
    req.createdByName,
    req.createdByApt,
    req.visitorName,
    req.carPlate,
    req.comment,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(query));
}

function hasOpenTemporaryWindow(req: AppRequest): req is AppRequest & { validUntil: string | Date } {
  return Boolean(req.passDuration === 'temporary' && req.validUntil);
}

function matchesGuardSearch(req: AppRequest, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;
  return [
    req.visitorName,
    req.carPlate,
    req.createdByName,
    req.createdByApt,
    req.comment,
  ].some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery));
}

function isResidentUser(user: AppUser): user is AppUser & { apartment: string } {
  return (user.role === ROLES.OWNER || user.role === ROLES.TENANT)
    && typeof user.apartment === 'string'
    && user.apartment !== '—';
}

function getResidentPerms(permsByUser: Record<string, UserPerms>, uid: string): UserPerms {
  const value = permsByUser[uid];
  if (value && typeof value === 'object' && Array.isArray(value.visitors) && Array.isArray(value.workers)) {
    return value;
  }
  return { visitors: [], workers: [] };
}

function normalizeDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function fmtDateFull(value: string | number | Date): string {
  const date = normalizeDate(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (day.getTime() === today.getTime()) return 'Сегодня';
  if (day.getTime() === yesterday.getTime()) return 'Вчера';
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString('ru-RU', sameYear
    ? { day: 'numeric', month: 'long', weekday: 'short' }
    : { day: 'numeric', month: 'long', year: 'numeric' });
}

export type VisitLogSelectorRow = {
  id: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: string | Date;
  category?: string;
  createdByUid?: string | null;
  createdByName?: string;
  createdByApt?: string;
  passDuration?: PassDuration | null;
  visitorName?: string | null;
  carPlate?: string | null;
  arrivedAt?: string | Date | null;
  comment?: string;
  result?: 'allowed' | 'denied' | string | null;
  actorName?: string | null;
  actorRole?: string | null;
  requestId?: string | null;
  timestamp?: string | Date;
  requestSnapshot?: Partial<AppRequest>;
  reason?: string;
};

export type GroupedVisitLogs = Array<{ label: string; items: VisitLogSelectorRow[] }>;
export type DecisionFilter = 'all' | 'allowed' | 'denied';
export type PeriodFilter = 'all' | 'today' | 'week' | 'month';

function groupByVisitDate(items: VisitLogSelectorRow[]): GroupedVisitLogs {
  const map: Record<string, VisitLogSelectorRow[]> = {};
  for (const item of items) {
    const key = fmtDateFull(item.arrivedAt || item.createdAt);
    if (!map[key]) map[key] = [];
    map[key].push(item);
  }
  return Object.entries(map).map(([label, groupedItems]) => ({ label, items: groupedItems }));
}

export function makeSelectResidentComputed() {
  return createSelector(
    [
      selectRequests,
      (_state: AppStoreSnapshot, uid: string) => uid,
      (_state: AppStoreSnapshot, _uid: string, passFilter: string) => passFilter,
      (_state: AppStoreSnapshot, _uid: string, _passFilter: string, techFilter: string) => techFilter,
    ],
    (requests, uid, passFilter, techFilter) => {
      const myPasses = requests.filter((r) => r.createdByUid === uid && r.type === 'pass');
      const myTech = requests.filter((r) => r.createdByUid === uid && r.type === 'tech');
      const scheduledPasses = myPasses.filter((r) => r.status === 'scheduled');
      const basePasses = myPasses.filter((r) => r.status !== 'scheduled');

      let filteredPasses: AppRequest[];
      if (passFilter === 'all') filteredPasses = basePasses;
      else if (passFilter === 'active') filteredPasses = basePasses.filter((r) => !INACTIVE_STATUSES.has(r.status));
      else if (passFilter === 'scheduled') filteredPasses = scheduledPasses;
      else filteredPasses = basePasses.filter((r) => (r.passDuration || 'once') === passFilter);

      const filteredTech = techFilter === 'all'
        ? myTech
        : myTech.filter((r) => !INACTIVE_STATUSES.has(r.status));

      const tempCount = myPasses.filter((r) => r.passDuration === 'temporary').length;
      const permCount = myPasses.filter((r) => r.passDuration === 'permanent').length;
      const completedRequests = requests
        .filter((r) => r.createdByUid === uid && COMPLETED_STATUSES.has(r.status))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      return { myPasses, myTech, scheduledPasses, filteredPasses, filteredTech, tempCount, permCount, completedRequests };
    },
  );
}

export function makeSelectAdminCollections() {
  return createSelector([selectRequests, selectUsers], (requests, usersById) => {
    const allUsers = Object.values(usersById);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayTs = now.getTime();
    let todayPassCount = 0;
    let todayTechCount = 0;
    let pendingCount = 0;
    let arrivedCount = 0;

    for (const request of requests) {
      if (getRequestTime(request) >= todayTs) {
        if (request.type === 'pass') todayPassCount += 1;
        if (request.type === 'tech') todayTechCount += 1;
      }
      if (request.status === 'pending') pendingCount += 1;
      if (request.status === 'arrived') arrivedCount += 1;
    }

    const contractorCount = allUsers.filter((user) => user.role === ROLES.CONTRACTOR).length;
    const roleCount = allUsers.reduce<Record<string, number>>((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});
    const stats: ReadonlyArray<readonly [AppIconName, number, string]> = [
      ['users', allUsers.length, 'Пользователей'],
      ['tools', contractorCount, 'Подрядчиков'],
      ['ticket', todayPassCount, 'Пропусков сегодня'],
      ['tools', todayTechCount, 'Техзаявок сегодня'],
      ['history', pendingCount, 'Ожидают решения'],
      ['check', arrivedCount, 'Входов отмечено'],
    ];

    return {
      requests,
      requestCount: requests.length,
      allUsers: allUsers as AppUser[],
      stats,
      roleCount,
    };
  });
}

export function makeSelectConciergeCollections() {
  return createSelector(
    [
      selectRequests,
      (_state: AppStoreSnapshot, query: string) => query,
    ],
    (requests, query) => ({
      allPasses: sortRequestsDesc(requests.filter((request) => request.type === 'pass' && matchesRequestQuery(request, query))),
      allTech: sortRequestsDesc(requests.filter((request) => request.type === 'tech' && matchesRequestQuery(request, query))),
    }),
  );
}

export function makeSelectGuardCollections() {
  return createSelector(
    [
      selectRequests,
      (_state: AppStoreSnapshot, query: string) => query,
    ],
    (requests, query) => {
      const approvedRequests: AppRequest[] = [];
      const temporaryRequests: Array<{ req: AppRequest & { validUntil: string | Date }; ts: number }> = [];
      const pendingTechRequests: AppRequest[] = [];
      const activeTechRequests: AppRequest[] = [];

      for (const req of requests) {
        if (req.type === 'pass') {
          const isOpenForSecurity = req.status === 'pending' || req.status === 'approved';

          if (hasOpenTemporaryWindow(req) && (isOpenForSecurity || req.status === 'arrived')) {
            temporaryRequests.push({ req, ts: new Date(req.validUntil).getTime() });
            continue;
          }

          if (isOpenForSecurity && req.passDuration !== 'temporary') {
            approvedRequests.push(req);
          }
          continue;
        }

        if (req.type === 'tech' && (req.status === 'pending' || req.status === 'accepted')) {
          if (req.status === 'pending') pendingTechRequests.push(req);
          activeTechRequests.push(req);
        }
      }

      temporaryRequests.sort((left, right) => left.ts - right.ts);
      const approved = sortOperationalRequests(approvedRequests);
      const temporary = temporaryRequests.map(({ req }) => req);
      const techPending = sortOperationalRequests(pendingTechRequests);
      const techActive = sortOperationalRequests(activeTechRequests);
      const techPendingCards = techActive.filter((req) => req.status === 'pending');
      const techAcceptedCards = techActive.filter((req) => req.status === 'accepted');
      const hasQuery = query.trim().length > 0;

      return {
        approved,
        temporary,
        techPending,
        techActive,
        filteredApproved: hasQuery ? approved.filter((req) => matchesGuardSearch(req, query)) : approved,
        filteredTemporary: hasQuery ? temporary.filter((req) => matchesGuardSearch(req, query)) : temporary,
        filteredTechPending: hasQuery ? techPendingCards.filter((req) => matchesGuardSearch(req, query)) : techPendingCards,
        filteredTechAccepted: hasQuery ? techAcceptedCards.filter((req) => matchesGuardSearch(req, query)) : techAcceptedCards,
      };
    },
  );
}

export function makeSelectTemplatesByType() {
  return createSelector(
    [
      selectTemplatesForUser,
    ],
    (templates) => ({
      templates,
      passes: templates.filter((template) => template.type === 'pass'),
      tech: templates.filter((template) => template.type === 'tech'),
    }),
  );
}

export type ResidentDirectoryResident = AppUser & {
  apartment: string;
  cars: Car[];
  perms: UserPerms;
};

export type ResidentDirectoryGroup = {
  apartment: string;
  residents: ResidentDirectoryResident[];
  cars: Car[];
  parkingSpots: string[];
};

export function makeSelectResidentsDirectory() {
  return createSelector(
    [
      selectUsers,
      selectPerms,
      selectGarage,
      (_state: AppStoreSnapshot, query: string) => query,
    ],
    (usersById, permsByUser, garageByUser, query) => {
      const byApartment: Record<string, ResidentDirectoryResident[]> = {};

      for (const user of Object.values(usersById)) {
        if (!isResidentUser(user)) continue;
        const resident: ResidentDirectoryResident = {
          ...user,
          apartment: user.apartment,
          cars: garageByUser[user.uid] ?? [],
          perms: getResidentPerms(permsByUser, user.uid),
        };
        if (!byApartment[resident.apartment]) byApartment[resident.apartment] = [];
        byApartment[resident.apartment].push(resident);
      }

      const groups = Object.entries(byApartment)
        .sort(([a], [b]) => {
          const na = parseInt(a, 10) || 0;
          const nb = parseInt(b, 10) || 0;
          return na - nb || a.localeCompare(b);
        })
        .map(([apartment, residents]) => ({
          apartment,
          residents,
          cars: residents.flatMap((resident) => resident.cars),
          parkingSpots: [...new Set(residents.map((resident) => resident.parkingSpot).filter((value): value is string => Boolean(value)))],
        }));

      const q = query.trim().toLowerCase();
      const filtered = q
        ? groups.filter((group) =>
          group.apartment.toLowerCase().includes(q)
          || group.residents.some((resident) => resident.name.toLowerCase().includes(q) || resident.phone.includes(q))
          || group.residents.some((resident) => (resident.parkingSpot || '').toLowerCase().includes(q))
          || group.residents.some((resident) => resident.cars.some((car) => car.plate.toLowerCase().includes(q))),
        )
        : groups;

      return {
        groups,
        filtered,
        totalResidents: filtered.reduce((count, group) => count + group.residents.length, 0),
      };
    },
  );
}

export function makeSelectVisitLogCollections() {
  return createSelector(
    [
      selectRequests,
      (_state: AppStoreSnapshot, visitEvents: VisitLogSelectorRow[]) => visitEvents,
      (_state: AppStoreSnapshot, _visitEvents: VisitLogSelectorRow[], role: string) => role,
      (_state: AppStoreSnapshot, _visitEvents: VisitLogSelectorRow[], _role: string, uid: string) => uid,
      (_state: AppStoreSnapshot, _visitEvents: VisitLogSelectorRow[], _role: string, _uid: string, period: PeriodFilter) => period,
      (
        _state: AppStoreSnapshot,
        _visitEvents: VisitLogSelectorRow[],
        _role: string,
        _uid: string,
        _period: PeriodFilter,
        decision: DecisionFilter,
      ) => decision,
      (
        _state: AppStoreSnapshot,
        _visitEvents: VisitLogSelectorRow[],
        _role: string,
        _uid: string,
        _period: PeriodFilter,
        _decision: DecisionFilter,
        query: string,
      ) => query,
    ],
    (requests, visitEvents, role, uid, period, decision, query) => {
      const requestsById = new Map<string, AppRequest>(requests.map((req) => [req.id, req]));
      let allVisits: VisitLogSelectorRow[] = visitEvents.map((event) => {
        const baseReq = event.requestSnapshot || (event.requestId ? requestsById.get(event.requestId) : undefined) || {};
        const timestamp = event.timestamp || baseReq.arrivedAt || baseReq.createdAt || new Date().toISOString();
        return {
          id: event.id || event.requestId || `${String(timestamp)}_${event.result}`,
          requestId: event.requestId || baseReq.id || null,
          type: baseReq.type || 'pass',
          category: event.category || baseReq.category || 'guest',
          visitorName: event.visitorName || baseReq.visitorName || null,
          carPlate: event.carPlate || baseReq.carPlate || null,
          createdByUid: event.createdByUid || baseReq.createdByUid || null,
          createdByName: event.createdByName || baseReq.createdByName || '—',
          createdByApt: event.createdByApt || baseReq.createdByApt || '—',
          passDuration: event.passDuration || baseReq.passDuration || null,
          createdAt: baseReq.createdAt || timestamp,
          arrivedAt: timestamp,
          status: event.result === 'denied' ? 'rejected' : 'arrived',
          result: event.result || null,
          actorName: event.actorName || null,
          actorRole: event.actorRole || null,
          comment: event.reason ? `Проверка QR: ${getValidationReasonLabel(event.reason)}` : '',
        };
      });

      if (role === ROLES.OWNER || role === ROLES.TENANT) {
        allVisits = allVisits.filter((row) => row.createdByUid === uid);
      }

      allVisits = allVisits
        .map((row) => ({ row, ts: normalizeDate(row.arrivedAt || row.createdAt).getTime() }))
        .sort((left, right) => right.ts - left.ts)
        .map(({ row }) => row);

      let visits = allVisits;
      if (period !== 'all') {
        const ms = period === 'today' ? 86_400_000 : period === 'week' ? 7 * 86_400_000 : 30 * 86_400_000;
        visits = visits.filter((row) => Date.now() - normalizeDate(row.arrivedAt || row.createdAt).getTime() < ms);
      }
      if (decision !== 'all') {
        visits = visits.filter((row) => row.result === decision);
      }

      const q = query.trim().toLowerCase();
      if (q) {
        visits = visits.filter((row) =>
          (row.visitorName || '').toLowerCase().includes(q)
          || (row.carPlate || '').toLowerCase().includes(q)
          || (row.createdByName || '').toLowerCase().includes(q)
          || (row.createdByApt || '').includes(q)
          || (row.comment || '').toLowerCase().includes(q),
        );
      }

      return {
        allVisits,
        visits,
        groups: groupByVisitDate(visits),
      };
    },
  );
}
