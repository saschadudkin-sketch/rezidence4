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

export type OperationsDashboardPeriod = '24h' | '7d' | '30d';

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
 * Shape of `{ user }` in `GET /api/v1/auth/me` response.  The legacy JWT still
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
  /** Resolved tenant feature flags; used by non-admin role workspaces for gated UI. */
  feature_flags?: Record<string, boolean> | null;
}

// ─── Property Admin Operations Dashboard ───────────────────────────────────

export type OperationsBreakdownItem<K extends string> = { total: number } & Record<K, string>;

export interface OperationsDashboardSnapshot {
  generated_at: IsoDateTime;
  property_id: UUID;
  period: {
    key: OperationsDashboardPeriod;
    hours: number;
  };
  requests: {
    created: number;
    completed: number;
    open: number;
    overdue_backlog: number;
    resolved_within_sla?: number;
    resolved_with_sla?: number;
    sla_compliance_rate: number | null;
    first_response_median_minutes: number | null;
    resolution_median_minutes: number | null;
    by_status: Array<OperationsBreakdownItem<'status'>>;
    by_priority: Array<OperationsBreakdownItem<'priority'>>;
  };
  access: {
    requests_created: number;
    requests_approved: number;
    requests_rejected: number;
    approval_rate: number | null;
    pending: number;
    expired: number;
    allow_count: number;
    denial_count: number;
    vehicle_traffic_count: number;
    avg_decision_sample_count: number;
    avg_decision_seconds: number | null;
    active_passes: number;
    used_passes: number;
    manual_override_count: number;
    offline_replay_count: number;
    trusted_visitors_active: number;
    trusted_visitor_passes_created: number;
    skud_failed_events: number;
    skud_manual_control_count: number;
    by_access_point: Array<{
      access_point_id: UUID | null;
      name: string;
      allow_count: number;
      denial_count: number;
      total: number;
    }>;
    deny_reasons: Array<OperationsBreakdownItem<'reason'>>;
    peak_traffic_windows: Array<OperationsBreakdownItem<'window_start'>>;
    manual_overrides_by_type: Array<OperationsBreakdownItem<'override_type'>>;
    offline_replay_by_status: Array<OperationsBreakdownItem<'replay_status'>>;
  };
  incidents: {
    open: number;
    investigating: number;
    closed: number;
    high_priority_open: number;
    blacklist_hits: number;
    suspicious_attempts: number;
    resolution_median_minutes: number | null;
    by_type: Array<OperationsBreakdownItem<'incident_type'>>;
  };
  notifications: {
    sent: number;
    failed: number;
    success_rate: number | null;
    queue: {
      pending: number;
      in_flight: number;
      sent: number;
      failed: number;
      dead: number;
    };
    oldest_pending_age_seconds: number | null;
    per_channel: Array<{
      channel: string;
      sent: number;
      failed: number;
      success_rate: number | null;
    }>;
  };
}

export interface OperationsDashboardResponse {
  ok: true;
  dashboard: OperationsDashboardSnapshot;
}

// ─── SKUD Provider Failure Dashboard ───────────────────────────────────────

export type SkudProviderStatus = 'active' | 'disabled' | 'degraded';
export type SkudHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'down';
export type SkudSyncMode = 'push' | 'pull' | 'hybrid' | 'manual';

export interface SkudProviderConfigSnapshot {
  id: UUID;
  property_id: UUID;
  provider: string;
  display_name: string;
  status: SkudProviderStatus;
  sync_mode: SkudSyncMode;
  capabilities?: unknown;
  health_status: SkudHealthStatus;
  last_success_at?: IsoDateTime | null;
  last_failure_at?: IsoDateTime | null;
  last_error?: string | null;
  created_by?: string | null;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
}

export interface SkudProviderEventSummary {
  total_events: number;
  succeeded_events: number;
  failed_events: number;
  retrying_events: number;
  dead_lettered_events: number;
  pending_events: number;
  ignored_events: number;
  last_event_at: IsoDateTime | null;
  last_failure_event_at: IsoDateTime | null;
}

export interface SkudProviderDeviceSummary {
  total_devices: number;
  degraded_devices: number;
  out_of_service_devices: number;
  manual_guard_devices: number;
  fail_closed_devices: number;
}

export interface SkudManualControlSummary {
  manual_control_events: number;
  last_manual_action_at: IsoDateTime | null;
}

export interface SkudProviderTopError {
  error_code: string;
  error_message: string | null;
  total: number;
  last_seen_at: IsoDateTime | null;
}

export interface SkudProviderFailureRow {
  provider_config: SkudProviderConfigSnapshot;
  event_summary: SkudProviderEventSummary;
  device_summary: SkudProviderDeviceSummary;
  manual_control_summary: SkudManualControlSummary;
  top_errors: SkudProviderTopError[];
  needs_attention: boolean;
  attention_reasons: string[];
}

export interface SkudFieldRolloutEvidenceRow {
  id: UUID;
  property_id: UUID;
  provider_config_id: UUID | null;
  hardware_device_id: UUID | null;
  provider: string | null;
  provider_display_name: string | null;
  hardware_device_name: string | null;
  rollout_stage: string;
  evidence_type: string;
  status: string;
  summary: string | null;
  metrics: Record<string, unknown>;
  observed_at: IsoDateTime | null;
  recorded_by_uid: string | null;
  created_at: IsoDateTime | null;
}

export interface SkudProviderFailureDashboard {
  property_id: UUID;
  generated_at: IsoDateTime;
  window_hours: number;
  summary: {
    providers_total: number;
    providers_down: number;
    providers_degraded: number;
    providers_needing_attention: number;
    failed_events: number;
    retrying_events: number;
    dead_lettered_events: number;
    manual_control_events: number;
    out_of_service_devices: number;
    field_rollout_records?: number;
  };
  providers: SkudProviderFailureRow[];
  field_rollout_records?: SkudFieldRolloutEvidenceRow[];
  field_rollout_evidence: {
    source_tables: string[];
    evidence_window_hours: number;
    returned_provider_configs: number;
    active_provider_configs: number;
    real_failure_rows: number;
    manual_control_event_rows: number;
    rollout_evidence_rows?: number;
    generated_at: IsoDateTime;
  };
}

export interface SkudProviderFailureDashboardResponse {
  dashboard: SkudProviderFailureDashboard;
}

// ─── Sensitive Action Review Reports ───────────────────────────────────────

export type AuditReviewStatus = 'pending' | 'approved' | 'needs_followup' | 'dismissed';
export type AuditReviewPriority = 'low' | 'normal' | 'high' | 'urgent';
export type AuditEscalationStatus = 'none' | 'overdue' | 'escalated';

export interface SensitiveActionReviewSummaryRow {
  review_status: AuditReviewStatus;
  priority: AuditReviewPriority;
  total: number;
  overdue: number;
}

export interface SensitiveActionReviewSummary {
  rows: SensitiveActionReviewSummaryRow[];
  totals: {
    total: number;
    overdue: number;
    by_status: Partial<Record<AuditReviewStatus, number>>;
    by_priority: Partial<Record<AuditReviewPriority, number>>;
  };
}

export interface SensitiveActionAntiAbuseFinding {
  actor_uid: string | null;
  actor_role: string | null;
  category: string;
  total_actions: number;
  high_risk_actions: number;
  pending_reviews: number;
  overdue_reviews: number;
  off_hours_actions: number;
  distinct_resources: number;
  first_seen_at?: IsoDateTime | null;
  last_seen_at?: IsoDateTime | null;
  flags: string[];
  risk_score: number;
}

export interface SensitiveActionAntiAbuseAnalytics {
  findings: SensitiveActionAntiAbuseFinding[];
  summary: {
    total_findings: number;
    actors: number;
    high_risk_actions: number;
    overdue_reviews: number;
  };
}

export interface SensitiveActionReviewAssignment {
  assigned_reviewer_staff_id: UUID | null;
  assigned_by_staff_id: UUID | null;
  assigned_at: IsoDateTime | null;
  due_at: IsoDateTime | null;
  priority: AuditReviewPriority;
  assignment_reason: string | null;
  escalation_status: AuditEscalationStatus;
  escalation_note: string | null;
  last_escalated_at: IsoDateTime | null;
  overdue: boolean;
}

export interface SensitiveActionReviewState {
  id: UUID | null;
  status: AuditReviewStatus;
  reviewer_staff_id: UUID | null;
  reviewed_at: IsoDateTime | null;
  comment: string | null;
  assignment: SensitiveActionReviewAssignment;
}

export interface SensitiveActionAuditRow {
  id: UUID;
  property_id: UUID | null;
  actor_uid: string | null;
  actor_role: string | null;
  actor_type: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  changes: unknown;
  ip_address: string | null;
  created_at: IsoDateTime;
  canonical_event_type: string;
  category: string;
  sensitivity: string;
  sensitive: boolean;
  review_required: boolean;
  review_reason: string | null;
  review: SensitiveActionReviewState;
}

export interface SensitiveActionMetaResponse {
  categories: string[];
  actions: string[];
  review_statuses: AuditReviewStatus[];
  priorities: AuditReviewPriority[];
  escalation_statuses: AuditEscalationStatus[];
  report_evidence_types?: string[];
  report_evidence_statuses?: string[];
}

export interface SensitiveActionSummaryResponse {
  summary: SensitiveActionReviewSummary;
}

export interface SensitiveActionAntiAbuseResponse {
  analytics: SensitiveActionAntiAbuseAnalytics;
}

export interface SensitiveActionListResponse {
  actions: SensitiveActionAuditRow[];
  page?: PageMeta;
}

// ─── Management Company Portfolio ──────────────────────────────────────────

export interface ManagementCompanyPortfolioProperty {
  id: UUID;
  slug: string;
  name: string;
  status: string | null;
  is_active: boolean;
  health: 'ok' | 'error';
  generated_at?: IsoDateTime;
  error?: string;
  hotspots: string[];
  requests?: OperationsDashboardSnapshot['requests'];
  access?: OperationsDashboardSnapshot['access'];
  incidents?: OperationsDashboardSnapshot['incidents'];
  notifications?: OperationsDashboardSnapshot['notifications'];
}

export interface ManagementCompanyPortfolioRanking {
  property_id: UUID;
  property_slug: string;
  property_name: string;
  value: number;
}

export interface ManagementCompanyPortfolioSnapshot {
  generated_at: IsoDateTime;
  management_company_id: UUID;
  period: {
    key: OperationsDashboardPeriod;
    hours: number | null;
  };
  filters: {
    property_slugs: string[];
    include_inactive: boolean;
  };
  rollup: {
    properties_total: number;
    properties_healthy: number;
    properties_error: number;
    hotspot_property_count: number;
    requests: Required<Pick<
      OperationsDashboardSnapshot['requests'],
      | 'created'
      | 'completed'
      | 'open'
      | 'overdue_backlog'
      | 'resolved_within_sla'
      | 'resolved_with_sla'
    >> & Pick<
      OperationsDashboardSnapshot['requests'],
      'sla_compliance_rate' | 'by_status' | 'by_priority'
    >;
    access: OperationsDashboardSnapshot['access'];
    incidents: Omit<OperationsDashboardSnapshot['incidents'], 'resolution_median_minutes'>;
    notifications: OperationsDashboardSnapshot['notifications'];
  };
  rankings: {
    overdue_backlog: ManagementCompanyPortfolioRanking[];
    incident_load: ManagementCompanyPortfolioRanking[];
    notification_failures: ManagementCompanyPortfolioRanking[];
  };
  properties: ManagementCompanyPortfolioProperty[];
  errors: Array<{
    property_id: UUID;
    property_slug: string;
    error: string;
  }>;
  formula_notes: {
    request_sla_compliance_rate: string;
    notification_success_rate: string;
    access_avg_decision_seconds: string;
    hotspot_property_count: string;
  };
}

export interface ManagementCompanyPortfolioResponse {
  ok: true;
  portfolio: ManagementCompanyPortfolioSnapshot;
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
  | 'escalated'
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
  guest_instructions: string | null;
  guard_notes: string | null;
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

export type PassCredentialType = 'qr' | 'pin' | 'plate' | 'ble' | 'card';

export interface AdminPassListItem extends Pass {
  request_type?: RequestType | null;
  visitor_name?: string | null;
  guest_instructions?: string | null;
  guard_notes?: string | null;
  unit_number?: string | null;
  unit_type?: string | null;
  resident_name?: string | null;
  vehicle_plate?: string | null;
  access_point_name?: string | null;
  access_zone_name?: string | null;
  credential_types?: PassCredentialType[];
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

export interface PinCredential {
  id: UUID;
  value: string;
  render_version: number;
  expires_at?: IsoDateTime | null;
  public_display_allowed: boolean;
  created_at?: IsoDateTime;
  updated_at?: IsoDateTime;
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

export type AccessPolicyMethod = 'qr' | 'manual' | 'plate' | 'ble' | 'card' | 'pin';
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

export type VerifyMode = 'qr' | 'pin' | 'plate';
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
  | 'invalid_pin'
  | 'pin_rate_limited'
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
  offline_replay_event_id?: UUID | null;
  occurred_at: IsoDateTime;
  created_at: IsoDateTime;
}

export interface VerifyRequest {
  property_id: UUID;
  mode: VerifyMode;
  token?: string;
  pin?: string;
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
  | 'invalid_pin'
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
  guard_device_id?: UUID | null;
  device_fingerprint?: string | null;
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

export type SecurityOfflineReplayEventType =
  | 'manual_admit'
  | 'manual_deny'
  | 'lookup_snapshot'
  | 'sync_error';

export interface SecurityOfflineReplayEvent
  extends Partial<Omit<ManualSecurityDecisionRequest, 'guard_device_id' | 'device_fingerprint'>> {
  client_event_id: string;
  event_type: SecurityOfflineReplayEventType;
  occurred_at: IsoDateTime;
}

export interface SecurityOfflineReplayRecord {
  id: UUID;
  property_id: UUID;
  client_event_id: string;
  event_type: SecurityOfflineReplayEventType;
  replay_status: 'accepted' | 'duplicate' | 'rejected';
  occurred_at: IsoDateTime;
  payload: Record<string, unknown>;
  processed_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export interface SecurityOfflineReplayResponse {
  results: Array<{
    replay_event: SecurityOfflineReplayRecord;
    result: ManualSecurityDecisionResponse | null;
  }>;
}

export interface GuardAuthorizedDevice {
  id: UUID;
  property_id: UUID;
  access_point_id: UUID | null;
  staff_user_id: UUID | null;
  device_fingerprint_preview?: string | null;
  label: string;
  status: 'pending' | 'active' | 'revoked';
  last_seen_at: IsoDateTime | null;
  approved_by_staff_id?: UUID | null;
  approved_at?: IsoDateTime | null;
  revoked_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface GuardAuthorizedDeviceContext {
  guard_device_id: UUID;
  device_fingerprint: string;
}

export interface GuardAuthorizedDeviceResponse {
  guard_authorized_device: GuardAuthorizedDevice;
}

export interface GuardAuthorizedDevicesResponse {
  guard_authorized_devices: GuardAuthorizedDevice[];
}

// ─── Security Workspace Hydrate/Search ─────────────────────────────────────

export interface SecurityWorkspaceStationContext {
  access_point: Pick<
    AccessPoint,
    'id' | 'property_id' | 'zone_id' | 'name' | 'point_type' | 'provider' | 'provider_external_id'
  > | null;
  access_zone: Pick<AccessZone, 'id' | 'name' | 'zone_type'> | null;
}

export interface SecurityWorkspaceActivePass {
  id: UUID;
  property_id: UUID;
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
  guest_instructions: string | null;
  guard_notes: string | null;
  plate_number: string | null;
  is_whitelisted: boolean | null;
  is_blacklisted: boolean | null;
  resident_name: string | null;
  resident_phone: string | null;
  unit_number: string | null;
  unit_type: UnitType | null;
}

export interface SecurityWorkspaceExpectedGuest {
  id: UUID;
  property_id: UUID;
  request_type: RequestType;
  visitor_name: string | null;
  visitor_phone: string | null;
  vehicle_id: UUID | null;
  target_zone_id: UUID | null;
  target_point_id: UUID | null;
  target_unit_id: UUID | null;
  trusted_visitor_id: UUID | null;
  reason: string | null;
  guest_instructions: string | null;
  guard_notes: string | null;
  share_delivery_channels: string[] | null;
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
  status: RequestStatus;
  approval_required: boolean;
  plate_number: string | null;
  unit_number: string | null;
  unit_type: UnitType | null;
  pass_id: UUID | null;
  pass_status: PassStatus | null;
}

// ─── Trusted Visitors ─────────────────────────────────────────────────────

export type TrustedVisitorType =
  | 'guest'
  | 'relative'
  | 'cleaner'
  | 'courier'
  | 'service'
  | 'caregiver'
  | 'other';

export interface TrustedVisitor {
  id: UUID;
  property_id: UUID;
  resident_id: UUID;
  name: string;
  phone: string | null;
  visitor_type: TrustedVisitorType;
  default_vehicle_plate: string | null;
  default_instructions: string | null;
  allowed_zone_id: UUID | null;
  allowed_point_id: UUID | null;
  is_active: boolean;
  last_used_at: IsoDateTime | null;
  recent_access_requests: AccessRequest[];
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export interface SecurityWorkspaceRecentEvent {
  id: UUID;
  property_id: UUID;
  pass_id: UUID | null;
  access_point_id: UUID | null;
  event_type: VisitEventType;
  event_source: VisitEventSource;
  person_label: string | null;
  vehicle_plate: string | null;
  performed_by_staff_id: UUID | null;
  occurred_at: IsoDateTime;
  created_at: IsoDateTime;
  access_point_name: string | null;
  access_zone_name: string | null;
  incident_id: UUID | null;
  incident_type: IncidentType | null;
  severity: Severity | null;
  incident_status: IncidentStatus | null;
}

export interface SecurityWorkspaceBlacklistHit {
  id: UUID;
  property_id: UUID;
  related_vehicle_id: UUID | null;
  related_visit_log_id: UUID | null;
  incident_type: IncidentType;
  severity: Severity;
  status: IncidentStatus;
  title: string;
  created_at: IsoDateTime;
  plate_number: string | null;
  owner_type: VehicleOwnerType | null;
  is_blacklisted: boolean | null;
}

export interface SecurityWorkspaceBootstrap {
  property_id: UUID;
  generated_at: IsoDateTime;
  station_context: SecurityWorkspaceStationContext;
  active_passes: SecurityWorkspaceActivePass[];
  expected_guests: SecurityWorkspaceExpectedGuest[];
  recent_events: SecurityWorkspaceRecentEvent[];
  blacklist_hits: SecurityWorkspaceBlacklistHit[];
}

export interface SecurityWorkspaceBootstrapResponse {
  workspace: SecurityWorkspaceBootstrap;
}

export type SecurityWorkspaceVehicleSearchRow = Omit<Vehicle, 'created_at' | 'updated_at'>;

export interface SecurityWorkspaceResidentSearchRow {
  id: UUID;
  property_id: UUID;
  unit_id: UUID;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: string | null;
  resident_type: string | null;
  is_active: boolean;
  unit_number: string;
  unit_type: UnitType;
}

export interface SecurityWorkspaceUnitSearchRow {
  id: UUID;
  property_id: UUID;
  building_id: UUID | null;
  entrance_id: UUID | null;
  unit_number: string;
  unit_type: UnitType;
  floor: number | null;
  is_active: boolean;
}

export interface SecurityWorkspacePassSearchRow {
  id: UUID;
  property_id: UUID;
  pass_type: PassType;
  subject_type: SubjectType;
  subject_resident_id: UUID | null;
  subject_vehicle_id: UUID | null;
  zone_id: UUID | null;
  point_id: UUID | null;
  valid_from: IsoDateTime;
  valid_until: IsoDateTime;
  status: PassStatus;
  plate_number: string | null;
  resident_name: string | null;
  unit_number: string | null;
}

export interface SecurityWorkspaceSearchResult {
  query: string;
  normalized_plate: string | null;
  vehicles: SecurityWorkspaceVehicleSearchRow[];
  residents: SecurityWorkspaceResidentSearchRow[];
  units: SecurityWorkspaceUnitSearchRow[];
  passes: SecurityWorkspacePassSearchRow[];
}

export interface SecurityWorkspaceSearchResponse {
  results: SecurityWorkspaceSearchResult;
}

export interface SecurityWorkspaceRecentEventsResponse {
  visit_logs: SecurityWorkspaceRecentEvent[];
  page?: PageMeta;
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

export type ServiceRequestCategoryDomain =
  | 'access'
  | 'service'
  | 'territory'
  | 'emergency'
  | 'security'
  | 'contractor';

export interface ServiceRequestCategory {
  id: UUID | null;
  code: string;
  name: string;
  domain: ServiceRequestCategoryDomain | string;
  targetScope: StaffRequestTargetType | string;
  priority: StaffRequestPriority;
  slaProfile: StaffSlaProfile;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  isEmergency: boolean;
  metadata: Record<string, unknown>;
}

export interface ServiceRequest {
  id: string;
  type: StaffRequestType | (string & {});
  category: string;
  status: StaffRequestStatus | (string & {});
  priority: StaffRequestPriority;
  slaProfile: StaffSlaProfile;
  requestCategoryId: UUID | null;
  targetType: StaffRequestTargetType | string | null;
  targetId: UUID | string | null;
  firstResponseDueAt: IsoDateTime | null;
  resolutionDueAt: IsoDateTime | null;
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
}

export interface ServiceRequestAttachment {
  id: UUID;
  requestId: string;
  uploadedByUid: string | null;
  fileUrl: string;
  fileKind: 'photo' | 'document' | 'other' | string | null;
  visibility: 'resident' | string;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime;
}

export interface ServiceRequestUpdate {
  id: UUID;
  requestId: string;
  actorUid: string | null;
  actorName: string | null;
  actorRole: string | null;
  body: string;
  visibility: 'resident' | string;
  attachmentIds: UUID[];
  createdAt: IsoDateTime;
}

export interface ServiceRequestHistoryRow {
  byName: string | null;
  byRole: string | null;
  action: string;
  at: IsoDateTime;
}

// ─── Emergency Dispatch Readiness ─────────────────────────────────────────

export type EmergencyType =
  | 'water'
  | 'heating'
  | 'electricity'
  | 'fire_smoke'
  | 'access_control'
  | 'security'
  | 'territory'
  | 'contractor'
  | 'other';

export type EmergencySeverity = 'P0' | 'P1' | 'P2';
export type EmergencyDispatchStatus =
  | 'new'
  | 'acknowledged'
  | 'dispatched'
  | 'escalated'
  | 'resolved'
  | 'cancelled';
export type EmergencyEscalationTarget =
  | 'security'
  | 'concierge'
  | 'technician'
  | 'contractor'
  | 'property_admin'
  | 'management_company_admin';
export type EmergencyNotificationStatus = 'pending' | 'sent' | 'failed' | 'not_required';
export type EmergencyDrillStatus = 'planned' | 'running' | 'passed' | 'failed' | 'cancelled';

export interface EmergencyDispatchProfile {
  id: UUID;
  propertyId: UUID | null;
  requestId: string;
  emergencyType: EmergencyType;
  severity: EmergencySeverity;
  dispatchStatus: EmergencyDispatchStatus;
  escalationTarget: EmergencyEscalationTarget;
  firstResponseDueAt: IsoDateTime | null;
  resolutionDueAt: IsoDateTime | null;
  acknowledgedAt: IsoDateTime | null;
  acknowledgedByUid: string | null;
  dispatchedAt: IsoDateTime | null;
  dispatchedByUid: string | null;
  escalatedAt: IsoDateTime | null;
  escalatedByUid: string | null;
  resolvedAt: IsoDateTime | null;
  notificationStatus: EmergencyNotificationStatus;
  metadata: Record<string, unknown>;
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
  request?: {
    type: string;
    category: string;
    status: string;
    createdByUid: string | null;
    createdByName: string | null;
    createdByRole: string | null;
    comment: string;
  };
}

export interface EmergencyOnCallRosterRow {
  id: UUID;
  propertyId: UUID | null;
  escalationTarget: EmergencyEscalationTarget;
  displayName: string;
  provider: 'internal_roster' | 'sms' | 'telegram' | 'web_push' | 'external_dispatch' | 'contractor_company';
  contactRef: string | null;
  status: 'active' | 'disabled' | 'archived';
  startsAt: IsoDateTime | null;
  endsAt: IsoDateTime | null;
  priority: number;
  metadata: Record<string, unknown>;
  updatedAt: IsoDateTime | null;
}

export interface EmergencyProviderNotificationEvidence {
  channel: string;
  status: string;
  total: number;
  failed: number;
  lastEventAt: IsoDateTime | null;
}

export interface EmergencyProviderDeliveryEvidence {
  id: UUID;
  propertyId: UUID | null;
  requestId: string | null;
  drillId: UUID | null;
  provider: string;
  channel: string;
  scenarioType: EmergencyType;
  status: string;
  latencyMs: number | null;
  externalDeliveryId: string | null;
  observedAt: IsoDateTime | null;
  recordedByUid: string | null;
  payload: Record<string, unknown>;
  createdAt: IsoDateTime | null;
}

export type EmergencyProviderDeliveryChannel =
  | 'web_push'
  | 'sms'
  | 'telegram'
  | 'email'
  | 'phone'
  | 'webhook'
  | 'external_dispatch'
  | 'contractor_company'
  | 'internal_roster';

export type EmergencyProviderDeliveryStatus =
  | 'sent'
  | 'delivered'
  | 'acknowledged'
  | 'failed'
  | 'timed_out'
  | 'not_required';

export interface EmergencyDispatchDrillRecord {
  id: UUID;
  propertyId: UUID | null;
  scenarioType: EmergencyType;
  severity: EmergencySeverity;
  escalationTarget: EmergencyEscalationTarget;
  requestId: string | null;
  status: EmergencyDrillStatus;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  createdByUid: string | null;
  summary: string | null;
  findings: Record<string, unknown>;
  notificationEvidence: Record<string, unknown>;
  createdAt: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
}

export interface EmergencyDispatchReadiness {
  property_id: UUID | null;
  generated_at: IsoDateTime;
  window_hours: number;
  summary: {
    active_emergencies: number;
    p0_active: number;
    first_response_overdue: number;
    resolution_overdue: number;
    notification_sent: number;
    notification_failed: number;
    active_on_call_rows: number;
    drill_records: number;
    provider_delivery_evidence_rows?: number;
  };
  queue: EmergencyDispatchProfile[];
  on_call_roster: EmergencyOnCallRosterRow[];
  provider_notification_evidence: EmergencyProviderNotificationEvidence[];
  drill_records: EmergencyDispatchDrillRecord[];
  live_provider_delivery_evidence?: EmergencyProviderDeliveryEvidence[];
  evidence: {
    source_tables: string[];
    notification_event_type: 'request.emergency_created' | string;
    returned_queue_rows: number;
    returned_roster_rows: number;
    returned_notification_rows: number;
    returned_drill_rows: number;
    returned_provider_delivery_rows?: number;
    generated_at: IsoDateTime;
  };
}

export type EmergencyDispatchReadinessResponse = EmergencyDispatchReadiness;

export interface EmergencyDispatchDrillResponse {
  drill: EmergencyDispatchDrillRecord;
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

export interface Building {
  id: UUID;
  property_id: UUID;
  code: string | null;
  name: string;
  sort_order: number;
  created_at: IsoDateTime;
}

export interface Entrance {
  id: UUID;
  building_id: UUID;
  code: string | null;
  name: string;
  sort_order: number;
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

// ─── Property Admin Directory ──────────────────────────────────────────────

export type StaffRole = 'security' | 'concierge' | 'technician' | 'property_admin';
export type StaffSpecialization = 'plumbing' | 'electric' | 'cleaning' | 'general';

export interface StaffUser {
  id: UUID;
  property_id: UUID;
  full_name: string;
  phone: string | null;
  email: string | null;
  role: StaffRole;
  specialization: StaffSpecialization | null;
  can_view_resident_phone: boolean;
  can_assign_requests: boolean;
  external_uid: UUID | null;
  is_active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export type ContractorCompanyStatus = 'active' | 'suspended' | 'terminated';

export interface ContractorCompany {
  id: UUID;
  property_id: UUID;
  name: string;
  status: ContractorCompanyStatus;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  active_users_count?: number;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export interface ContractorUser {
  id: UUID;
  contractor_company_id: UUID;
  property_id: UUID;
  full_name: string;
  phone: string | null;
  email: string | null;
  specialization: string | null;
  access_expires_at: IsoDateTime | null;
  external_uid: UUID | null;
  is_active: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export type MembershipSubjectType = 'resident' | 'staff' | 'contractor' | 'external';
export type MembershipScopeLevel = 'property' | 'building' | 'entrance' | 'unit' | 'management_company' | 'platform';
export type MembershipStatus = 'pending' | 'active' | 'suspended' | 'revoked' | 'ended';

export interface RoleScopeMembership {
  id: UUID;
  property_id: UUID;
  resident_id: UUID | null;
  staff_user_id: UUID | null;
  contractor_user_id: UUID | null;
  external_subject_type: MembershipSubjectType | string | null;
  external_subject_id: string | null;
  management_company_id: UUID | null;
  role: UserRole | string;
  scope_level: MembershipScopeLevel | string;
  scope_id: UUID | null;
  status: MembershipStatus | string;
  starts_at: IsoDateTime;
  ends_at: IsoDateTime | null;
  created_by_staff_id: UUID | null;
  provisioned_from: string | null;
  provisioned_at: IsoDateTime | null;
  revoked_at: IsoDateTime | null;
  revoked_reason: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export interface ResidentOffboardingSummary {
  offboarded_residents: number;
  offboarded_last_30d: number;
  vehicles_pending_review: number;
  recent_offboarding_rows: number;
}

export interface ResidentOffboardingRecord {
  id: UUID;
  property_id: UUID;
  resident_id: UUID;
  resident_name: string | null;
  unit_id: UUID | null;
  resident_active: boolean;
  actor_uid: string | null;
  actor_role: string | null;
  reason: string | null;
  summary: Record<string, number>;
  created_at: IsoDateTime;
}

export interface ResidentOffboardingVehicleReview {
  id: UUID;
  owner_resident_id: UUID | null;
  plate_number: string;
  is_whitelisted?: boolean;
  is_blacklisted?: boolean;
  review_required: boolean;
  offboarded_at?: IsoDateTime | null;
  offboarding_reason?: string | null;
  updated_at?: IsoDateTime | null;
}

export interface ResidentOffboardingReport {
  property_id: UUID;
  generated_at: IsoDateTime;
  summary: ResidentOffboardingSummary;
  recent_offboardings: ResidentOffboardingRecord[];
  vehicle_review_queue: ResidentOffboardingVehicleReview[];
  evidence: {
    source_tables: string[];
    report_scope: 'resident_offboarding';
    generated_at: IsoDateTime;
  };
}

export interface ResidentOffboardingReportResponse {
  report: ResidentOffboardingReport;
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

// ─── GIS/OSS readiness ────────────────────────────────────────────────────
// Source: backend/src/v1/routes/gisOssReadiness.js.
// Spec:   docs/product/specs/platform-v1/gis-oss-readiness-spec.md.

export type GisOssPackageType =
  | 'gis_zhkh'
  | 'oss_readiness'
  | 'resident_notice'
  | 'protocol_archive';

export interface GisOssProtocolFile {
  label: string;
  file_url: string;
  file_mime?: string | null;
  signed_at?: IsoDateTime | string | null;
}

export interface GisOssOperationalRef {
  type: string;
  id: string;
  note?: string | null;
}

export interface GisOssArtifactManifestFile {
  path: string;
  role: string;
  content_type: string;
  source_url?: string | null;
  source_mime?: string | null;
  byte_size: number;
  sha256: string;
}

export interface GisOssArtifactManifest {
  payload_path: string;
  package_payload_sha256: string;
  material_counts: {
    documents: number;
    announcements: number;
    protocol_files: number;
    operational_record_refs: number;
  };
  files: GisOssArtifactManifestFile[];
}

export interface GisOssExportPayload {
  format_version: 'gis_oss_readiness.v1' | string;
  packaging?: {
    format_version: 'gis_oss_artifact_manifest.v1' | string;
    artifact_filename: string;
    artifact_content_type: string;
    manifest: GisOssArtifactManifest;
  };
  operational_evidence?: {
    generated_at: IsoDateTime;
    source_validation: Record<string, boolean>;
    immutable_storage: string;
    operator_review_required: boolean;
  };
  integration_path?: {
    current_mode: string;
    certified_submission_supported: boolean;
    future_certified_requirements?: string[];
  };
}

export interface GisOssExportPackage {
  id: UUID;
  property_id: UUID;
  package_type: GisOssPackageType;
  title: string;
  status: 'draft' | 'generated' | 'archived';
  period_start: string | null;
  period_end: string | null;
  document_ids: UUID[];
  announcement_ids: UUID[];
  protocol_files: GisOssProtocolFile[];
  operational_record_refs: GisOssOperationalRef[];
  export_payload: GisOssExportPayload | Record<string, unknown>;
  boundary_notice: string;
  legally_authoritative: false;
  certified_submission: false;
  generated_by_uid: string | null;
  generated_at: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
}

export interface GisOssBoundaryResponse {
  legally_authoritative: false;
  certified_submission: false;
  notice: string;
  out_of_scope: string[];
}

// ─── Notifications / outbox observability ─────────────────────────────────
// Source: backend/src/v1/routes/adminOutbox.js and notificationLog.js.

export type NotificationChannel = 'web_push' | 'sms' | 'telegram' | 'webhook' | 'email';
export type OutboxStatus = 'pending' | 'in_flight' | 'sent' | 'failed' | 'dead';
export type NotificationLogStatus = 'sent' | 'failed';
export type NotificationRecipientType = 'resident' | 'staff' | 'contractor' | 'external';

export interface AdminOutboxRow {
  id: UUID;
  property_id: UUID | null;
  event_type: string;
  channel: NotificationChannel;
  recipient_type: NotificationRecipientType | string;
  recipient_id: UUID | null;
  recipient_address: string | null;
  payload: Record<string, unknown> | null;
  status: OutboxStatus;
  attempt_count: number;
  max_attempts: number;
  next_attempt_at: IsoDateTime | null;
  last_attempted_at: IsoDateTime | null;
  last_error: string | null;
  sent_at: IsoDateTime | null;
  correlation_id: UUID | null;
  created_at: IsoDateTime;
}

export interface AdminOutboxListResponse {
  ok: true;
  items: AdminOutboxRow[];
  count: number;
  limit: number;
  offset: number;
}

export interface AdminOutboxMetrics {
  ok: true;
  counts: Record<OutboxStatus, number>;
  per_channel: Array<Record<OutboxStatus, number> & { channel: NotificationChannel }>;
  per_event_type: Array<{ event_type: string; total: number }>;
  oldest_pending_age_seconds: number | null;
  generated_at: IsoDateTime;
}

export interface AdminOutboxSla {
  ok: true;
  awaiting_pickup_total: number;
  awaiting_pickup_over_7d: number;
  awaiting_pickup_over_14d: number;
  awaiting_pickup_over_30d: number;
  reminders_sent_24h: number;
  followups_sent_24h: number;
  admin_alerts_sent_24h: number;
  received_24h: number;
  thresholds: {
    remind_days: number;
    followup_days: number;
    admin_alert_days: number;
  };
  generated_at: IsoDateTime;
}

export interface OutboxHealthResponse {
  ok: true;
  feature_enabled: boolean;
  counts: Record<OutboxStatus, number>;
  stuck_in_flight: number;
  oldest_pending_age_seconds: number | null;
  ts: IsoDateTime;
}

export interface OutboxRetryBody {
  ids?: UUID[];
  status?: Extract<OutboxStatus, 'dead' | 'failed'>;
  limit?: number;
}

export interface OutboxRetryResponse {
  ok: true;
  revived: number;
  revivedIds: UUID[];
}

export interface NotificationLogRow {
  id: UUID;
  property_id?: UUID | null;
  outbox_id?: UUID | null;
  recipient_type: NotificationRecipientType | string;
  recipient_id: UUID | null;
  recipient_address?: string | null;
  channel: NotificationChannel;
  event_type: string;
  status: NotificationLogStatus;
  payload: Record<string, unknown> | null;
  error_code: string | null;
  error_message?: string | null;
  provider_message_id?: string | null;
  attempt_count: number;
  sent_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export interface NotificationLogListResponse {
  ok: true;
  items: NotificationLogRow[];
  count: number;
  limit?: number;
  offset?: number;
}

export interface NotificationLogMetrics {
  ok: true;
  period: '24h' | '7d' | '30d';
  period_hours: number;
  generated_at: IsoDateTime;
  channels: Array<{
    channel: NotificationChannel;
    sent: number;
    failed: number;
    success_rate: number | null;
  }>;
  top_events: Array<{ event_type: string; total: number }>;
  top_errors: Array<{ error_code: string; total: number }>;
}

export interface NotificationLogMetaResponse {
  ok: true;
  limit_max: number;
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
