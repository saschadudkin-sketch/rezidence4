/**
 * platform-v1 API barrel.
 *
 * Keep surface area narrow: consumers import `api.*` from here, never from
 * individual resource modules.  This makes it easy to evolve method names in
 * one place.
 */

export * from './types';
export { V1ApiError, isV1ApiError, classifyByStatus } from './errors';
export type { V1ErrorKind, V1ApiErrorPayload } from './errors';
export { v1Client } from './client';
export type { RequestOpts } from './client';

import { accessRequestsApi } from './accessRequests';
import { passesApi } from './passes';
import { vehiclesApi, normalizePlate } from './vehicles';
import { visitsApi } from './visits';
import { accessIncidentsApi } from './accessIncidents';
import { unitsApi } from './units';
import { residentsApi } from './residents';
import { sessionApi } from './session';
import { announcementsApi, deriveStatus as deriveAnnouncementStatus } from './announcements';

export const api = {
  accessRequests: accessRequestsApi,
  passes: passesApi,
  vehicles: vehiclesApi,
  visits: visitsApi,
  incidents: accessIncidentsApi,
  units: unitsApi,
  residents: residentsApi,
  session: sessionApi,
  announcements: announcementsApi,
};

export { normalizePlate };
export { deriveAnnouncementStatus };

export type {
  ListAccessRequestsParams,
  CreateAccessRequestBody,
} from './accessRequests';
export type { ListPassesParams } from './passes';
export type {
  ListVehiclesParams,
  CreateVehicleBody,
  UpdateVehicleBody,
} from './vehicles';
export type { ListVisitsParams } from './visits';
export type { ListIncidentsParams, ListOverridesParams } from './accessIncidents';
export type { ListUnitsParams } from './units';
export type { ListResidentsParams, ResidentWithUnit } from './residents';
export type {
  ListAnnouncementsParams,
  ListAdminAnnouncementsParams,
  CreateAnnouncementBody,
  UpdateAnnouncementBody,
  AnnouncementReachMetrics,
} from './announcements';
