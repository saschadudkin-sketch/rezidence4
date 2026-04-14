import { createSelector } from 'reselect';
import type { AppStoreSnapshot } from '../boundedContexts/contexts';
import type { AppRequest, RequestStatus } from '../slices/requestsSlice';

const INACTIVE_STATUSES = new Set<RequestStatus>(['cancelled', 'rejected', 'expired']);
const COMPLETED_STATUSES = new Set<RequestStatus>(['arrived', 'rejected', 'expired', 'cancelled']);

const selectRequests = (state: AppStoreSnapshot) => state.reqState.requests;

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
  return createSelector([selectRequests], (requests) => ({
    requests,
    requestCount: requests.length,
  }));
}
