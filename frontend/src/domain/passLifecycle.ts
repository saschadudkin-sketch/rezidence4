import { ROLES } from './permissions';
import type { AppRequest, PassDuration, RequestStatus, RequestType } from '../store/slices/requestsSlice';

type PassLike = Pick<AppRequest, 'type' | 'status' | 'passDuration' | 'createdByRole'>;

export function isResidentAutoApprovedRole(role?: string | null): boolean {
  return role === ROLES.OWNER || role === ROLES.TENANT;
}

export function isOneTimePassDuration(passDuration?: PassDuration | null): boolean {
  return (passDuration ?? 'once') === 'once';
}

export function isResidentOneTimePass(req: Pick<AppRequest, 'type' | 'passDuration' | 'createdByRole'>): boolean {
  return req.type === 'pass'
    && isOneTimePassDuration(req.passDuration)
    && isResidentAutoApprovedRole(req.createdByRole);
}

export function getRequestInitialStatus({
  type,
  userRole,
  passDuration,
  isScheduled,
}: {
  type: RequestType;
  userRole?: string | null;
  passDuration?: PassDuration | null;
  isScheduled: boolean;
}): RequestStatus {
  if (isScheduled) return 'scheduled';
  if (type === 'pass' && isOneTimePassDuration(passDuration) && isResidentAutoApprovedRole(userRole)) {
    return 'approved';
  }
  return 'pending';
}

export function isSecurityActionablePass(req: PassLike): boolean {
  return req.type === 'pass'
    && (
      req.status === 'pending'
      || (req.status === 'approved' && isResidentOneTimePass(req))
    );
}
