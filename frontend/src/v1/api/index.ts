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
import { serviceRequestsApi } from './serviceRequests';
import { operationsDashboardApi } from './operationsDashboard';
import { managementCompanyPortfolioApi } from './managementCompanyPortfolio';
import { adminOutboxApi } from './adminOutbox';
import { notificationLogApi } from './notificationLog';
import { privacyComplianceApi } from './privacyCompliance';
import { analyticsApi } from './analytics';
import { erpExchangeApi } from './erpExchange';
import { webhooksApi } from './webhooks';
import { guardVisitsApi } from './guardVisits';

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
  serviceRequests: serviceRequestsApi,
  operationsDashboard: operationsDashboardApi,
  managementCompanyPortfolio: managementCompanyPortfolioApi,
  adminOutbox: adminOutboxApi,
  notificationLog: notificationLogApi,
  privacyCompliance: privacyComplianceApi,
  analytics: analyticsApi,
  erpExchange: erpExchangeApi,
  webhooks: webhooksApi,
  guardVisits: guardVisitsApi,
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
export type {
  CreateStaffBody,
  ListStaffParams,
  StaffImportApplyResponse,
  StaffImportChecklist,
  StaffImportPayload,
  StaffImportPreviewResponse,
  StaffImportPreviewRow,
  StaffImportRowInput,
  UpdateStaffBody,
} from './staff';
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
export type {
  GetSkudProviderFailuresParams,
  ListSkudHardwareDevicesParams,
  ListSkudManualControlEventsParams,
  SkudFieldRolloutEvidenceBody,
  SkudHardwareBoundaryBody,
  SkudManualControlBody,
  SkudSyncPassBody,
} from './skudIntegrations';
export type {
  AssignSensitiveActionReviewBody,
  EscalateSensitiveActionsBody,
  RecordSensitiveActionReportEvidenceBody,
  ReviewSensitiveActionBody,
  SampleSensitiveActionsBody,
  SensitiveActionAntiAbuseParams,
  SensitiveActionListParams,
  SensitiveActionReportEvidence,
  SensitiveActionReportEvidenceParams,
  SensitiveActionReportEvidenceStatus,
  SensitiveActionReportEvidenceType,
  SensitiveActionReportParams,
  SensitiveActionReviewDecision,
  SensitiveActionReviewRecord,
} from './auditReviews';
export type {
  CreateEmergencyDrillBody,
  GetEmergencyDispatchReadinessParams,
} from './emergencyDispatch';
export type {
  CreateEmergencyProviderDeliveryEvidenceBody,
  CreateServiceRequestAttachmentBody,
  CreateServiceRequestBody,
  CreateServiceRequestUpdateBody,
  ListServiceRequestCategoriesParams,
  ListServiceRequestsParams,
  ServiceRequestEmergencyDispatchAction,
  ServiceRequestEmergencyDispatchBody,
  ServiceRequestEmergencyQueueParams,
  ServiceRequestRateBody,
  UpdateServiceRequestBody,
  UpsertServiceRequestCategoryBody,
} from './serviceRequests';
export type { GetOperationsDashboardParams } from './operationsDashboard';
export type { GetManagementCompanyPortfolioParams } from './managementCompanyPortfolio';
export type { ListAdminOutboxParams } from './adminOutbox';
export type {
  ListNotificationLogParams,
  NotificationLogPeriod,
} from './notificationLog';
export type {
  AcceptPrivacyConsentBody,
  CompleteDataSubjectRequestBody,
  CreateComplianceEvidenceBody,
  CreateDataSubjectRequestBody,
  DataSubjectExportParams,
  DeleteAccountBody,
  ListComplianceEvidenceParams,
  ListDataSubjectRequestsParams,
  PrivacyConsentStatus,
} from './privacyCompliance';
export type {
  AnalyticsDateRangeParams,
  AnalyticsGranularity,
  AnalyticsPeriod,
  AnalyticsSnapshot,
  AnalyticsSnapshotParams,
  CreateAnalyticsSnapshotResponse,
  CreateAnalyticsSnapshotBody,
  PackagesAnalyticsResponse,
  RequestsAnalyticsResponse,
  SlaAnalyticsResponse,
  TopResidentsAnalyticsParams,
  TopResidentsAnalyticsResponse,
  TrafficAnalyticsParams,
  TrafficAnalyticsResponse,
} from './analytics';
export type {
  CreateErpProviderBody,
  ErpExportBody,
  ErpExportDataset,
  ErpExportResponse,
  ErpExportSummary,
  ErpHealthStatus,
  ErpImportBody,
  ErpImportDataset,
  ErpImportResponse,
  ErpImportSummary,
  ErpProvider,
  ErpProviderConfig,
  ErpProviderStatus,
  ErpSyncDirection,
  ErpSyncJob,
  ErpSyncJobMode,
  ErpSyncJobResponse,
  ErpSyncJobStatus,
  ErpSyncMode,
  ErpSyncRecord,
  ErpSyncRecordOperation,
  ErpSyncRecordStatus,
  ErpSyncSource,
  ListErpProvidersParams,
} from './erpExchange';
export type {
  CreateWebhookBody,
  UpdateWebhookBody,
  Webhook,
  WebhookDelivery,
  WebhookDeliveryStatus,
} from './webhooks';
export type {
  CreateGuardVisitBody,
  GuardVisitDetailResponse,
  GuardVisitIncidentSummary,
  ListGuardVisitsParams,
} from './guardVisits';
