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
import { trustedVisitorsApi } from './trustedVisitors';
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
import { staffApi } from './staff';
import { contractorsApi } from './contractors';
import { membershipsApi } from './memberships';
import { sessionApi } from './session';
import { announcementsApi, deriveStatus as deriveAnnouncementStatus } from './announcements';
import { packagesApi, packageStatusTone } from './packages';
import { documentsApi, deriveDocumentStatus } from './documents';
import { gisOssReadinessApi } from './gisOssReadiness';
import { skudIntegrationsApi } from './skudIntegrations';
import { auditReviewsApi } from './auditReviews';
import { emergencyDispatchApi } from './emergencyDispatch';
import { operationsDashboardApi } from './operationsDashboard';
import { managementCompanyPortfolioApi } from './managementCompanyPortfolio';
import { adminOutboxApi } from './adminOutbox';
import { notificationLogApi } from './notificationLog';

export const api = {
  accessRequests: accessRequestsApi,
  trustedVisitors: trustedVisitorsApi,
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
  staff: staffApi,
  contractors: contractorsApi,
  memberships: membershipsApi,
  session: sessionApi,
  announcements: announcementsApi,
  packages: packagesApi,
  documents: documentsApi,
  gisOssReadiness: gisOssReadinessApi,
  skudIntegrations: skudIntegrationsApi,
  auditReviews: auditReviewsApi,
  emergencyDispatch: emergencyDispatchApi,
  operationsDashboard: operationsDashboardApi,
  managementCompanyPortfolio: managementCompanyPortfolioApi,
  adminOutbox: adminOutboxApi,
  notificationLog: notificationLogApi,
};

export { normalizePlate };
export { deriveAnnouncementStatus };
export { packageStatusTone };
export { deriveDocumentStatus };

export type {
  ListAccessRequestsParams,
  CreateAccessRequestBody,
} from './accessRequests';
export type {
  CreatePassFromTrustedVisitorBody,
  CreateTrustedVisitorBody,
  ListTrustedVisitorsParams,
  TrustedVisitorPassRequestType,
  UpdateTrustedVisitorBody,
} from './trustedVisitors';
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
export type {
  EnrollGuardAuthorizedDeviceBody,
  ListGuardAuthorizedDevicesParams,
  RevokeGuardAuthorizedDeviceBody,
} from './securityWorkspace';
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
export type {
  GetResidentOffboardingReportParams,
  ListResidentsParams,
  ResidentWithUnit,
} from './residents';
export type { ListStaffParams } from './staff';
export type {
  ListContractorCompaniesParams,
  ListContractorUsersParams,
} from './contractors';
export type { ListMembershipsParams } from './memberships';
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
export type {
  CreateGisOssExportPackageBody,
  ListGisOssExportPackagesParams,
} from './gisOssReadiness';
export type { GetSkudProviderFailuresParams } from './skudIntegrations';
export type {
  SensitiveActionAntiAbuseParams,
  SensitiveActionListParams,
  SensitiveActionReportParams,
} from './auditReviews';
export type {
  CreateEmergencyDrillBody,
  GetEmergencyDispatchReadinessParams,
} from './emergencyDispatch';
export type { GetOperationsDashboardParams } from './operationsDashboard';
export type { GetManagementCompanyPortfolioParams } from './managementCompanyPortfolio';
export type { ListAdminOutboxParams } from './adminOutbox';
export type {
  ListNotificationLogParams,
  NotificationLogPeriod,
} from './notificationLog';
