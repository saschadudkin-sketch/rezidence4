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
import { accessTopologyApi } from './accessTopology';
import { accessPoliciesApi } from './accessPolicies';
import { visitsApi } from './visits';
import { securityWorkspaceApi } from './securityWorkspace';
import { accessIncidentsApi } from './accessIncidents';
import { staffWorkspaceApi } from './staffWorkspace';
import { technicianWorkspaceApi } from './technicianWorkspace';
import { contractorWorkspaceApi } from './contractorWorkspace';
import { unitsApi } from './units';
import { residentsApi } from './residents';
import { sessionApi } from './session';
import { announcementsApi, deriveStatus as deriveAnnouncementStatus } from './announcements';
import { packagesApi, packageStatusTone } from './packages';
import { documentsApi, deriveDocumentStatus } from './documents';
import { operationsDashboardApi } from './operationsDashboard';
import { managementCompanyPortfolioApi } from './managementCompanyPortfolio';

export const api = {
  accessRequests: accessRequestsApi,
  passes: passesApi,
  vehicles: vehiclesApi,
  accessTopology: accessTopologyApi,
  accessPolicies: accessPoliciesApi,
  visits: visitsApi,
  securityWorkspace: securityWorkspaceApi,
  incidents: accessIncidentsApi,
  staffWorkspace: staffWorkspaceApi,
  technicianWorkspace: technicianWorkspaceApi,
  contractorWorkspace: contractorWorkspaceApi,
  units: unitsApi,
  residents: residentsApi,
  session: sessionApi,
  announcements: announcementsApi,
  packages: packagesApi,
  documents: documentsApi,
  operationsDashboard: operationsDashboardApi,
  managementCompanyPortfolio: managementCompanyPortfolioApi,
};

export { normalizePlate };
export { deriveAnnouncementStatus };
export { packageStatusTone };
export { deriveDocumentStatus };

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
export type {
  CreateAccessPointBody,
  CreateAccessZoneBody,
  ListAccessZonesParams,
  ListAccessPointsParams,
} from './accessTopology';
export type { CreateAccessPolicyBody, ListAccessPoliciesParams } from './accessPolicies';
export type { ListVisitsParams } from './visits';
export type { ListIncidentsParams, ListOverridesParams } from './accessIncidents';
export type {
  AssignStaffRequestBody,
  CreateInternalCommentBody,
  ListStaffWorkspaceInboxParams,
  UpdateStaffRequestStatusBody,
} from './staffWorkspace';
export type {
  ListTechnicianWorkspaceQueueParams,
  ResolveTechnicianRequestBody,
  SetTechnicianWaitingBody,
} from './technicianWorkspace';
export type {
  AssignContractorRequestBody,
  ListContractorWorkspaceQueueParams,
  ResolveContractorRequestBody,
  SetContractorWaitingBody,
} from './contractorWorkspace';
export type { ListUnitsParams } from './units';
export type { ListResidentsParams, ResidentWithUnit } from './residents';
export type {
  ListAnnouncementsParams,
  ListAdminAnnouncementsParams,
  CreateAnnouncementBody,
  UpdateAnnouncementBody,
  AnnouncementReachMetrics,
} from './announcements';
export type {
  ListPackagesParams,
  ListMinePackagesParams,
  PackageMetricsParams,
  PackageMetricsPeriod,
  CreatePackageBody,
  UpdatePackageBody,
  PickupPackageBody,
  ReturnPackageBody,
  MarkLostPackageBody,
} from './packages';
export type {
  ListDocumentsParams,
  ListPublicDocumentsParams,
  CreateDocumentBody,
  UpdateDocumentBody,
} from './documents';
export type { GetOperationsDashboardParams } from './operationsDashboard';
export type { GetManagementCompanyPortfolioParams } from './managementCompanyPortfolio';
