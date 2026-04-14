import apiClient from '../providers/apiClient';
import { isLiveMode } from '../../config/runtimeMode';
import type { RequestStatus } from '../../store/slices/requestsSlice';

type TransitionRule = { from: RequestStatus[]; to: RequestStatus[] } | null;
type StatusTransitionsResponse = {
  roles: Record<string, TransitionRule>;
  version: number;
};

let cachedPromise: Promise<StatusTransitionsResponse> | null = null;

export async function getStatusTransitions(): Promise<StatusTransitionsResponse | null> {
  if (!isLiveMode()) return null;
  if (!cachedPromise) {
    cachedPromise = apiClient.get('/api/v1/contracts/status-transitions') as Promise<StatusTransitionsResponse>;
  }
  return cachedPromise;
}

export async function canTransitionOnFrontend(role: string, currentStatus: RequestStatus, nextStatus: RequestStatus): Promise<boolean> {
  const response = await getStatusTransitions();
  if (!response) return true;
  const rules = response.roles?.[role];
  if (!rules) return true;
  return rules.from.includes(currentStatus) && rules.to.includes(nextStatus);
}

export function resetStatusTransitionsCache() {
  cachedPromise = null;
}
