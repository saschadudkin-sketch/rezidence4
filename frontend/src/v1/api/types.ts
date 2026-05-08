/**
 * platform-v1 API types.
 *
 * Shapes mirror EXACTLY what `backend/src/v1/routes/*.js` returns.  Any field
 * that is not in the backend response MUST NOT appear here — derived values
 * belong in selectors.  See docs/product/specs/platform-v1/* for contracts.
 *
 * Phase 4 — D-lite.  Do not import from legacy frontend types; they encode
 * different ACL/visibility assumptions.
 */

export type UUID = string;
export type IsoDateTime = string; // ISO-8601 string from PG timestamps

// ─── Pagination ─────────────────────────────────────────────────────────────
// Backend returns `page` meta on list endpoints when client passes
// limit/offset (см. backend/src/v1/lib/pagination.js).  Existing clients
// без limit/offset продолжают получать массив без `page`, поэтому в response
// types `page` помечается optional.

export interface PageMeta {
  limit: number;
  offset: number;
  /** True iff returnedCount === limit — клиенту стоит запросить next page. */
  hasMore: boolean;
}

/**
 * Common pagination query params для list endpoints.  Embed via intersection:
 * `interface ListXxxParams extends PaginationParams { ... }`.
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

// ─── Session ────────────────────────────────────────────────────────────────

export type UserRole =
  | 'resident'
  | 'owner'
  | 'tenant'
  | 'contractor'
  | 'concierge'
  | 'security'
  | 'technician'
  | 'property_admin'
  | 'management_company_admin'
  | 'platform_admin'
  | 'admin'
  // legacy roles still present in prod — we type them for safety
  | 'user'
  | 'staff';

export type PropertyType =
  | 'residential_complex'
  | 'club_house'
  | 'cottage_community';

/**
 * Shape of `{ user }` in `GET /api/auth/me` response.  The legacy JWT still
 * drives auth so the row comes straight from `users` (not v1 tables).
 *
 * `property_id` is resolved via LEFT JOIN on `properties.slug = users.property_slug`
 * so that staff-facing pages (guard console, concierge) can call v1 endpoints
 * that require `property_id` without a second round-trip.
 */
export interface UserMe {
  uid: UUID;
  role: UserRole;
  name: string;
  phone?: string | null;
  apartment?: string | null;
  avatar?: string | null;
  /** Mounted per-property; used by the tenant resolver. */
  property_slug?: string | null;
  /** Resolved from property_slug on the backend.  `null` only in edge cases. */
  property_id?: UUID | null;
  /** Resolved from the platform/local property registry; drives address labels. */
  property_type?: PropertyType | null;
}

// ─── Access Requests ────────────────────────────────────────────────────────

export type RequestType =
  | 'guest_access'
  | 'vehicle_access'
  | 'contractor_access'
  | 'courier_access'
  | 'service_access'
  | 'temporary_resident_access';

export type RequestStatus =
  | 'new'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type CreatorType = 'resident' | 'staff' | 'contractor';

export interface AccessRequest {
  id: UUID;
  property_id: UUID;
  created_by_type: CreatorType;
  created_by_resident_id: UUID | null;
  created_by_staff_id: UUID | null;
  created_by_contractor_user_id: UUID | null;
  request_type: RequestType;
  visitor_name: string | null;
  visitor_phone: string | null;
  vehicle_id: UUID | null;
  target_zone_id: UUID | null;
  target_point_id: UUID | null;
  target_unit_id: UUID | null;
  reason: string | null;
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
  status: RequestStatus;
  approval_required: boolean;
  approved_at: IsoDateTime | null;
  rejected_at: IsoDateTime | null;
  cancelled_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export type ApprovalDecision = 'approved' | 'rejected' | 'escalated';
export type ApproverType = 'staff' | 'resident';

export interface AccessApproval {
  id: UUID;
  access_request_id?: UUID;
  approver_type: ApproverType;
  approver_staff_id: UUID | null;
  approver_resident_id: UUID | null;
  decision: ApprovalDecision;
  comment: string | null;
  created_at: IsoDateTime;
}

// ─── Passes ─────────────────────────────────────────────────────────────────

export type PassStatus =
  | 'active'
  | 'used'
  | 'revoked'
  | 'blocked'
  | 'expired';

export type PassType =
  | 'guest'
  | 'vehicle'
  | 'resident'
  | 'staff'
  | 'contractor'
  | 'courier'
  | 'service'
  | 'emergency';

export type SubjectType =
  | 'guest'
  | 'resident'
  | 'staff'
  | 'contractor_user'
  | 'vehicle';

export interface Pass {
  id: UUID;
  property_id: UUID;
  access_request_id: UUID | null;
  pass_type: PassType;
  subject_type: SubjectType;
  subject_resident_id: UUID | null;
  subject_staff_id: UUID | null;
  subject_contractor_user_id: UUID | null;
  subject_vehicle_id: UUID | null;
  zone_id: UUID | null;
  point_id: UUID | null;
  policy_id: UUID | null;
  valid_from: IsoDateTime;
  valid_until: IsoDateTime;
  status: PassStatus;
  approved_by_staff_id: UUID | null;
  revoked_at: IsoDateTime | null;
  revoked_by_staff_id: UUID | null;
  revoked_reason: string | null;
  created_at: IsoDateTime;
}

/**
 * Compact pass projection returned inside access-request detail and
 * verify response.  Backend deliberately drops sensitive columns here.
 */
export interface PassSummary {
  id: UUID;
  pass_type: PassType;
  status: PassStatus;
  valid_from: IsoDateTime;
  valid_until: IsoDateTime;
}

export interface QrToken {
  id: UUID;
  token: string;
  render_version: number;
  created_at?: IsoDateTime;
}

// ─── Vehicles ───────────────────────────────────────────────────────────────

export type VehicleOwnerType = 'resident' | 'staff' | 'contractor' | 'guest';
export type VehicleKind = 'car' | 'motorcycle' | 'truck' | 'service_vehicle';

export interface Vehicle {
  id: UUID;
  property_id: UUID;
  owner_type: VehicleOwnerType;
  owner_resident_id: UUID | null;
  owner_staff_id: UUID | null;
  owner_contractor_user_id: UUID | null;
  plate_number: string;
  vehicle_type: VehicleKind;
  color: string | null;
  brand: string | null;
  model: string | null;
  is_whitelisted: boolean;
  is_blacklisted: boolean;
  notes: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

// ─── Access Topology ───────────────────────────────────────────────────────

export type AccessZoneType =
  | 'perimeter'
  | 'checkpoint'
  | 'residential_entry'
  | 'parking'
  | 'guest_parking'
  | 'resident_parking'
  | 'public_area'
  | 'technical_area'
  | 'service_area'
  | 'street'
  | 'sector';

export type AccessPointType =
  | 'gate'
  | 'barrier'
  | 'door'
  | 'turnstile'
  | 'wicket'
  | 'intercom'
  | 'checkpoint'
  | 'service_gate';

export interface AccessZone {
  id: UUID;
  property_id: UUID;
  building_id: UUID | null;
  name: string;
  zone_type: AccessZoneType;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export interface AccessPoint {
  id: UUID;
  property_id: UUID;
  zone_id: UUID;
  name: string;
  point_type: AccessPointType;
  provider: string | null;
  provider_external_id: string | null;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  metadata: Record<string, unknown> | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

// ─── Access Policies ───────────────────────────────────────────────────────

export type AccessPolicySubjectType =
  | 'resident'
  | 'guest'
  | 'staff'
  | 'contractor'
  | 'contractor_user'
  | 'vehicle'
  | 'courier';

export type AccessPolicyMethod = 'qr' | 'manual' | 'plate' | 'ble' | 'card' | 'face' | 'pin';
export type AccessPolicyApprovalMode = 'auto' | 'required' | 'security_only' | 'admin_only';
export type AccessPolicyEffect =
  | 'allow'
  | 'deny'
  | 'needs_approval'
  | 'needs_security_review'
  | 'incident_required';

export interface AccessPolicy {
  id: UUID;
  property_id: UUID;
  name: string;
  subject_type: AccessPolicySubjectType;
  subject_role: string | null;
  zone_id: UUID | null;
  point_id: UUID | null;
  access_method: AccessPolicyMethod;
  approval_mode: AccessPolicyApprovalMode;
  effect: AccessPolicyEffect;
  priority: number;
  schedule_json: Record<string, unknown> | null;
  duration_minutes: number | null;
  is_recurring: boolean;
  is_active: boolean;
  created_by: UUID | null;
  metadata: Record<string, unknown> | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

// ─── Visits (visit_logs_v2) + verify ────────────────────────────────────────

export type VerifyMode = 'qr' | 'plate';
export type VerifyDirection = 'entry' | 'exit';

export type VisitEventType =
  | 'entry_allowed'
  | 'entry_denied'
  | 'exit_allowed'
  | 'exit_denied'
  | 'manual_admit'
  | 'manual_deny'
  | 'override';

export type VisitEventSource = 'domhub' | 'skud' | 'guard_console' | 'import';

export type DenyReason =
  | 'invalid_qr'
  | 'invalid_plate'
  | 'vehicle_blacklisted'
  | 'pass_revoked'
  | 'pass_blocked'
  | 'pass_used'
  | 'expired'
  | 'outside_time_window'
  | 'unauthorized_vehicle'
  | 'idempotent_replay';

export interface VisitLog {
  id: UUID;
  property_id: UUID;
  pass_id: UUID | null;
  access_point_id: UUID | null;
  event_type: VisitEventType;
  event_source: VisitEventSource;
  person_label: string | null;
  vehicle_plate: string | null;
  performed_by_staff_id: UUID | null;
  provider_event_id: string | null;
  provider_payload: Record<string, unknown> | null;
  occurred_at: IsoDateTime;
  created_at: IsoDateTime;
}

export interface VerifyRequest {
  property_id: UUID;
  mode: VerifyMode;
  token?: string;
  plate?: string;
  access_point_id?: UUID | null;
  direction?: VerifyDirection;
  occurred_at?: IsoDateTime;
}

export interface VerifyResult {
  allowed: boolean;
  reason?: DenyReason | string; // backend may add new reasons before FE
  direction?: VerifyDirection;
  policy_decision?: Record<string, unknown> | null;
  visit_log_id: UUID | null;
  incident_id: UUID | null;
  pass: PassSummary | null;
}

// ─── Incidents / Overrides ──────────────────────────────────────────────────

export type IncidentType =
  | 'expired_pass_attempt'
  | 'invalid_qr'
  | 'invalid_plate'
  | 'blacklist_hit'
  | 'outside_time_window'
  | 'unauthorized_vehicle'
  | 'manual_override'
  | 'provider_conflict'
  | 'suspicious_repeat_attempt'
  | 'policy_denied'
  | 'policy_security_review_required';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type IncidentStatus =
  | 'open'
  | 'investigating'
  | 'resolved'
  | 'dismissed';

export interface AccessIncident {
  id: UUID;
  property_id: UUID;
  related_pass_id: UUID | null;
  related_visit_log_id: UUID | null;
  related_vehicle_id: UUID | null;
  incident_type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  description: string | null;
  created_by_staff_id: UUID | null;
  assigned_to_staff_id: UUID | null;
  resolved_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export type OverrideType =
  | 'manual_admit'
  | 'manual_deny'
  | 'temporary_whitelist'
  | 'temporary_block';

export type ManualDecision = 'manual_admit' | 'manual_deny';
export type ManualDecisionDegradedReason =
  | 'cached_lookup'
  | 'no_lookup'
  | 'manual_admit'
  | 'manual_deny'
  | 'later_reconciliation'
  | 'connectivity_loss'
  | 'provider_outage'
  | 'policy_override';
export type ManualDecisionLookupState =
  | 'online'
  | 'cached_hit'
  | 'cached_miss'
  | 'not_checked'
  | 'unavailable';

export interface AccessOverride {
  id: UUID;
  property_id: UUID;
  incident_id: UUID | null;
  pass_id: UUID | null;
  performed_by_staff_id: UUID;
  override_type: OverrideType;
  reason: string;
  created_at: IsoDateTime;
}

export interface ManualSecurityDecisionRequest {
  property_id: UUID;
  access_point_id?: UUID | null;
  decision: ManualDecision;
  direction?: VerifyDirection;
  reason: string;
  pass_id?: UUID | null;
  vehicle_id?: UUID | null;
  related_vehicle_id?: UUID | null;
  person_label?: string | null;
  vehicle_plate?: string | null;
  degraded_mode?: boolean;
  degraded_reason?: ManualDecisionDegradedReason | null;
  lookup_state?: ManualDecisionLookupState | null;
  occurred_at?: IsoDateTime | null;
  severity?: Severity | null;
}

export interface ManualSecurityDecisionResponse {
  visit_log: VisitLog;
  incident: AccessIncident;
  override: AccessOverride;
}

// ─── Staff Workspace / Service Requests ────────────────────────────────────

export type StaffWorkspaceQueue =
  | 'active'
  | 'unassigned'
  | 'assigned'
  | 'mine'
  | 'overdue'
  | 'emergency'
  | 'all';

export type StaffRequestStatus =
  | 'pending'
  | 'new'
  | 'triaged'
  | 'assigned'
  | 'approved'
  | 'accepted'
  | 'in_progress'
  | 'waiting_resident'
  | 'waiting_parts'
  | 'waiting_contractor'
  | 'resolved'
  | 'arrived'
  | 'cancelled'
  | 'scheduled'
  | 'expired'
  | 'completed'
  | 'rejected';

export type StaffRequestPriority = 'low' | 'normal' | 'high' | 'emergency';
export type StaffSlaProfile = 'standard' | 'urgent' | 'emergency';

export type StaffRequestType =
  | 'pass'
  | 'tech'
  | 'repair'
  | 'cleaning'
  | 'concierge'
  | 'complaint'
  | 'suggestion'
  | 'car'
  | 'move_in'
  | 'move_out'
  | 'service'
  | 'territory'
  | 'emergency';

export type StaffRequestTargetType =
  | 'unit'
  | 'home'
  | 'access_zone'
  | 'access_point'
  | 'common_territory'
  | 'road'
  | 'service_area';

export type StaffSlaState =
  | 'on_track'
  | 'responded'
  | 'escalated'
  | 'emergency_escalated'
  | 'resolved'
  | (string & {});

export interface StaffWorkspaceRequest {
  id: string;
  type: StaffRequestType | (string & {});
  category: string;
  status: StaffRequestStatus;
  priority: StaffRequestPriority;
  slaProfile: StaffSlaProfile;
  requestCategoryId: UUID | null;
  targetType: StaffRequestTargetType | null;
  targetId: UUID | null;
  firstResponseDueAt: IsoDateTime | null;
  resolutionDueAt: IsoDateTime | null;
  dueAt: IsoDateTime | null;
  isOverdue: boolean;
  emergencyMetadata: Record<string, unknown>;
  assignedToUid: string | null;
  assignedToName: string | null;
  assignedToRole: string | null;
  assignedAt: IsoDateTime | null;
  assignedContractorUserId: UUID | null;
  assignedContractorCompanyId: UUID | null;
  startedAt: IsoDateTime | null;
  firstResponseAt: IsoDateTime | null;
  resolvedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  resolutionNote: string | null;
  requiresFollowUp: boolean;
  slaState: StaffSlaState;
  escalationLevel: number;
  escalatedAt: IsoDateTime | null;
  escalationReason: string | null;
  lastSlaCheckAt: IsoDateTime | null;
  createdByUid: string;
  createdByName: string;
  createdByRole: string;
  createdByApt: string | null;
  visitorName: string | null;
  visitorPhone: string | null;
  carPlate: string | null;
  comment: string | null;
  passDuration: string | null;
  validUntil: IsoDateTime | null;
  scheduledFor: IsoDateTime | null;
  arrivedAt: IsoDateTime | null;
  photos: string[];
  photo: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime | null;
  resident: {
    id?: UUID | null;
    uid: string | null;
    name: string | null;
    apt: string | null;
  };
  counters: {
    residentUpdates: number;
    internalComments: number;
    slaEvents: number;
  };
}

// ─── Technician Workspace ─────────────────────────────────────────────────

export type TechnicianWorkspaceQueue =
  | 'active'
  | 'mine'
  | 'available'
  | 'in_progress'
  | 'waiting'
  | 'resolved'
  | 'all';

export interface TechnicianWorkflowState {
  canClaim: boolean;
  canStart: boolean;
  canResume: boolean;
  canWait: boolean;
  canResolve: boolean;
}

export interface TechnicianWorkspaceRequest extends Omit<StaffWorkspaceRequest, 'counters'> {
  workflow: TechnicianWorkflowState;
  counters: StaffWorkspaceRequest['counters'] & {
    technicianEvents: number;
  };
}

export interface StaffWorkspaceProperty {
  id: UUID | null;
  slug: string | null;
  type: PropertyType | null;
}

export interface StaffWorkspaceAttachment {
  id: UUID;
  requestId: string;
  uploadedByUid: string | null;
  fileUrl: string;
  fileKind: string | null;
  visibility: 'resident' | 'internal' | (string & {});
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface StaffWorkspaceUpdate {
  id: UUID;
  requestId: string;
  actorUid: string | null;
  actorName: string | null;
  actorRole: string | null;
  body: string;
  visibility: 'resident' | 'internal' | (string & {});
  attachmentIds: UUID[];
  createdAt: IsoDateTime;
}

export interface StaffWorkspaceSlaEvent {
  id: UUID;
  requestId: string;
  eventKey: string;
  eventType: string;
  severity: string;
  dueAt: IsoDateTime | null;
  detectedAt: IsoDateTime | null;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface StaffWorkspaceRequestDetail {
  request: StaffWorkspaceRequest;
  attachments: StaffWorkspaceAttachment[];
  residentUpdates: StaffWorkspaceUpdate[];
  internalComments: StaffWorkspaceUpdate[];
  slaEvents: StaffWorkspaceSlaEvent[];
}

export interface TechnicianWorkspaceEvent {
  id: UUID;
  requestId: string;
  technicianUid: string | null;
  actorUid: string | null;
  actorName: string | null;
  actorRole: string | null;
  eventType: string;
  fromStatus: StaffRequestStatus | string | null;
  toStatus: StaffRequestStatus | string;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface TechnicianWorkspaceRequestDetail {
  request: TechnicianWorkspaceRequest;
  attachments: StaffWorkspaceAttachment[];
  residentUpdates: StaffWorkspaceUpdate[];
  internalComments: StaffWorkspaceUpdate[];
  slaEvents: StaffWorkspaceSlaEvent[];
  technicianEvents: TechnicianWorkspaceEvent[];
}

// ─── Contractor Workspace ─────────────────────────────────────────────────

export type ContractorWorkspaceQueue =
  | 'active'
  | 'mine'
  | 'in_progress'
  | 'waiting'
  | 'waiting_assignment'
  | 'resolved'
  | 'all';

export interface ContractorWorkflowState {
  canStart: boolean;
  canResume: boolean;
  canWait: boolean;
  canResolve: boolean;
}

export interface ContractorWorkspaceProfile {
  id: UUID | null;
  uid: string | null;
  fullName: string | null;
  companyId: UUID | null;
  companyName: string | null;
  companyStatus: string | null;
  accessExpiresAt: IsoDateTime | null;
}

export interface ContractorWorkspaceRequest extends Omit<StaffWorkspaceRequest, 'counters'> {
  contractor: ContractorWorkspaceProfile | null;
  workflow: ContractorWorkflowState;
  counters: {
    residentUpdates: number;
    contractorEvents: number;
  };
}

export interface ContractorWorkspaceEvent {
  id: UUID;
  requestId: string;
  contractorUserId: UUID | null;
  contractorCompanyId: UUID | null;
  contractorUid: string | null;
  actorUid: string | null;
  actorName: string | null;
  actorRole: string | null;
  eventType: string;
  fromStatus: StaffRequestStatus | string | null;
  toStatus: StaffRequestStatus | string;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface ContractorWorkspaceRequestDetail {
  request: ContractorWorkspaceRequest;
  attachments: StaffWorkspaceAttachment[];
  residentUpdates: StaffWorkspaceUpdate[];
  internalComments: StaffWorkspaceUpdate[];
  slaEvents: StaffWorkspaceSlaEvent[];
  contractorEvents: ContractorWorkspaceEvent[];
}

export interface StaffResidentQuickView {
  resident: {
    id: UUID;
    externalUid: string | null;
    propertyId: UUID;
    fullName: string;
    phone: string | null;
    email: string | null;
    role: string | null;
    residentType: string;
    isActive: boolean;
    unit: {
      id: UUID;
      number: string;
      type: string;
      floor: number | null;
      buildingId: UUID | null;
      buildingName: string | null;
      buildingCode: string | null;
      entranceId: UUID | null;
      entranceName: string | null;
      entranceCode: string | null;
    };
  };
  vehicles: Array<Pick<
    Vehicle,
    | 'id'
    | 'property_id'
    | 'plate_number'
    | 'vehicle_type'
    | 'color'
    | 'brand'
    | 'model'
    | 'is_whitelisted'
    | 'is_blacklisted'
  >>;
  requestCounts: Partial<Record<StaffRequestStatus | string, number>>;
  recentRequests: StaffWorkspaceRequest[];
}

// ─── Structure ──────────────────────────────────────────────────────────────

export type UnitType =
  | 'apartment'
  | 'townhouse'
  | 'house'
  | 'commercial'
  | 'utility';

export interface Unit {
  id: UUID;
  property_id: UUID;
  building_id: UUID;
  entrance_id: UUID;
  unit_number: string;
  unit_type: UnitType;
  floor: number | null;
  is_active: boolean;
  created_at: IsoDateTime;
}

// ─── Residents ──────────────────────────────────────────────────────────────

export type ResidentType = 'owner' | 'tenant' | 'family_member';

export interface Resident {
  id: UUID;
  external_uid?: UUID | null;
  property_id: UUID;
  unit_id: UUID | null;
  full_name: string;
  phone: string | null;
  email: string | null;
  role?: string | null;
  resident_type: ResidentType;
  is_active: boolean;
  consent_given_at: IsoDateTime | null;
  consent_version?: string | null;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime | null;
}

// ─── Announcements (announcements_v2) ──────────────────────────────────────
// Source: backend/src/v1/routes/announcements.js + services/announcements.js.
// Category/audience/channel values mirror the ALLOWED_* arrays in the service.

export type AnnouncementCategory =
  | 'general'
  | 'maintenance'
  | 'event'
  | 'emergency'
  | 'marketing';

export type AnnouncementAudienceType = 'all' | 'building' | 'entrance' | 'unit_type';

export type AnnouncementUnitType = 'owner' | 'tenant' | 'family_member';

export type AnnouncementChannel = 'web_push' | 'sms' | 'telegram' | 'email';

/**
 * Admin status filter values accepted by `GET /api/v1/admin/announcements`.
 * Not a column — derived by service from (deleted_at, published_at,
 * starts_at, expires_at).  Frontend derives the same way client-side for
 * displaying status badges (see announcements.ts deriveStatus).
 */
export type AnnouncementStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'expired'
  | 'deleted';

export interface Announcement {
  id: UUID;
  property_id: UUID;
  title: string;
  body_md: string;
  is_urgent: boolean;
  category: AnnouncementCategory;
  audience_type: AnnouncementAudienceType;
  audience_building_id: UUID | null;
  audience_entrance_id: UUID | null;
  audience_unit_type: AnnouncementUnitType | null;
  starts_at: IsoDateTime;
  expires_at: IsoDateTime | null;
  is_pinned: boolean;
  notify_channels: AnnouncementChannel[];
  created_by_staff_id: UUID | null;
  published_at: IsoDateTime | null;
  published_by_staff_id: UUID | null;
  deleted_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

// ─── Packages (packages_v2) ────────────────────────────────────────────────
// Source: backend/src/v1/routes/packages.js + services/packages.js.
// Spec:   docs/product/specs/platform-v1/packages-v2-spec.md §2-§5.
//
// State machine §3: awaiting_pickup → {picked_up, returned, lost}. All
// terminal transitions; 409 if caller tries to move out of a terminal state.
// CHECK constraints on the DB enforce pickup_identity_exclusive /
// pickup_identity_required — frontend prevents setting both fields but the
// backend is the source of truth on 400s.

export type PackageStatus =
  | 'awaiting_pickup'
  | 'picked_up'
  | 'returned'
  | 'lost';

export type PackageSize =
  | 'envelope'
  | 'small'
  | 'medium'
  | 'large'
  | 'oversize';

export interface Package {
  id: UUID;
  property_id: UUID;
  unit_id: UUID;
  recipient_resident_id: UUID | null;
  recipient_name_snapshot: string | null;
  sender_name: string | null;
  carrier: string | null;
  tracking_number: string | null;
  photo_url: string | null;
  size_category: PackageSize | null;
  received_at: IsoDateTime;
  received_by_staff_id: UUID;
  storage_location: string | null;
  status: PackageStatus;
  picked_up_at: IsoDateTime | null;
  picked_up_by_resident_id: UUID | null;
  picked_up_by_name: string | null;
  picked_up_by_staff_id: UUID | null;
  returned_at: IsoDateTime | null;
  returned_reason: string | null;
  notes: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

/** Aggregated package metrics response — `GET /api/v1/packages/metrics?period=...`. */
export interface PackageMetrics {
  period: '24h' | '7d' | '30d';
  totals: Record<PackageStatus, number>;
  received: number;
  picked_up: number;
  awaiting_pickup: number;
  median_dwell_hours: number | null;
  /** Backend may add new aggregates; index-signature keeps FE forward-compat. */
  [key: string]: unknown;
}

// ─── Documents (documents_v2) ──────────────────────────────────────────────
// Source: backend/src/v1/routes/documents.js + services/documents.js.
// Spec:   docs/product/specs/platform-v1/documents-v2-spec.md §2-§5.
//
// Static content: rules, УК contacts, instructions, contracts, safety, legal.
// No outbox / no fan-out (пассивный справочник).
// Snapshot-on-PATCH: every body_md/title/file_url change inserts a
// document_versions row (history tracked by backend, not a separate
// resource here — fetched via the admin sub-router).
// Concierge capability: write только в contacts/instructions; admin — везде.
// Public endpoint скрывает legal/contracts даже при is_public=true.

export type DocumentCategory =
  | 'rules'
  | 'contacts'
  | 'instructions'
  | 'contracts'
  | 'safety'
  | 'legal'
  | 'other';

/**
 * Derived client-side status for displaying badges.  Mirrors the service's
 * (published_at, deleted_at) combinations.
 */
export type DocumentStatus = 'draft' | 'published' | 'deleted';

export interface V1Document {
  id: UUID;
  property_id: UUID;
  title: string;
  category: DocumentCategory;
  tag: string | null;
  body_md: string | null;
  file_url: string | null;
  file_mime: string | null;
  file_size_bytes: number | null;
  is_public: boolean;
  sort_order: number;
  published_at: IsoDateTime | null;
  created_by_staff_id: UUID | null;
  updated_by_staff_id: UUID | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
  deleted_at: IsoDateTime | null;
}

/**
 * Snapshot row from `document_versions`.  `version` is monotonic per document
 * (1 = first edit recorded, i.e. the state before that edit).  Only visible
 * to admin via `/api/v1/admin/documents/:id/versions`.
 */
export interface DocumentVersion {
  id: UUID;
  document_id: UUID;
  version: number;
  title: string;
  category: DocumentCategory;
  tag: string | null;
  body_md: string | null;
  file_url: string | null;
  file_mime: string | null;
  file_size_bytes: number | null;
  is_public: boolean;
  sort_order: number;
  changed_by_staff_id: UUID | null;
  reason: string | null;
  created_at: IsoDateTime;
}

// ─── Composite response shapes (exactly what the backend returns) ──────────

export interface AccessRequestDetailResponse {
  access_request: AccessRequest;
  approvals: AccessApproval[];
  pass: PassSummary | null;
}

export interface IncidentDetailResponse {
  incident: AccessIncident;
  overrides: AccessOverride[];
}

export interface UnitDetailResponse {
  unit: Unit;
  /** Residents attached to this unit — lightweight projection, no phone. */
  residents: Array<Pick<Resident, 'id' | 'full_name' | 'resident_type' | 'is_active' | 'consent_given_at'>>;
}
