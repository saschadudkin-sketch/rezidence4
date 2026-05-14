import { createSelector } from 'reselect';
import { ROLES } from '../../domain/permissions';
import type { AppIconName } from '../../ui/AppIcon';
import type { AppStoreSnapshot } from '../boundedContexts/contexts';
import type { AppRequest, RequestStatus } from '../slices/requestsSlice';
import type { AppUser } from '../slices/usersSlice';

const INACTIVE_STATUSES = new Set<RequestStatus>(['cancelled', 'rejected', 'expired']);
const COMPLETED_STATUSES = new Set<RequestStatus>(['arrived', 'rejected', 'expired', 'cancelled']);
const EMPTY_REQUESTS: AppRequest[] = [];
const EMPTY_USERS: Record<string, AppUser> = {};

const selectRequests = (state: AppStoreSnapshot) => state.reqState?.requests ?? EMPTY_REQUESTS;
const selectUsers = (state: AppStoreSnapshot) => state.usersState?.users ?? EMPTY_USERS;

function getRequestTime(request: AppRequest): number {
  const time = new Date(request.createdAt).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortRequestsDesc(requests: AppRequest[]): AppRequest[] {
  return [...requests].sort((left, right) => getRequestTime(right) - getRequestTime(left));
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
