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

// ─── Session ────────────────────────────────────────────────────────────────

export type UserRole =
  | 'owner'
  | 'tenant'
  | 'contractor'
  | 'concierge'
  | 'security'
  | 'admin'
  // legacy roles still present in prod — we type them for safety
  | 'user'
  | 'staff';

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

// ─── Visits (visit_logs_v2) + verify ────────────────────────────────────────

export type VerifyMode = 'qr' | 'plate';

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
  occurred_at?: IsoDateTime;
}

export interface VerifyResult {
  allowed: boolean;
  reason?: DenyReason | string; // backend may add new reasons before FE
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
  | 'suspicious_repeat_attempt';

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
