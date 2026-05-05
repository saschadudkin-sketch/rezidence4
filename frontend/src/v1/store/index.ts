/**
 * platform-v1 store barrel.
 */

export {
  V1SessionProvider,
  useV1Session,
  useV1SessionOpt,
  useV1SessionState,
  isResidentRole,
  isStaffRole,
  isGuardRole,
  isConciergeRole,
  normalizeUserRole,
} from './session';
export type { V1SessionValue, V1SessionProviderProps } from './session';

export {
  qk,
  invalidateAccessRequest,
  invalidateAnnouncement,
  invalidateDocument,
  invalidatePackage,
  invalidatePass,
  invalidateVehicle,
} from './queryKeys';
