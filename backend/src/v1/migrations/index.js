'use strict';

// platform-v1 property-DB migrations index.
// Each migration is a `{ id, up(client) }` module, run in array order by
// db.migrate() after the legacy MIGRATIONS array.  IDs are prefixed `v1_` so
// they never collide with legacy IDs in schema_migrations.
//
// FORWARD-ONLY: down() rollbacks намеренно не реализованы.  Реальная
// стратегия отката — forward-fix migration.  См. ./README.md для
// обоснования и conventions.
//
// See docs/product/specs/platform-v1/ for per-module specs.

const V1_PROPERTY_MIGRATIONS = [
  require('./001_buildings'),
  require('./002_entrances'),
  require('./003_units'),
  require('./004_residents'),
  require('./005_staff_users'),
  require('./006_contractor_companies'),
  require('./007_contractor_users'),
  require('./008_vehicles'),
  require('./009_access_requests'),
  require('./010_access_approvals'),
  require('./011_passes'),
  require('./012_qr_passes_v2'),
  require('./013_visit_logs_v2'),
  require('./014_access_incidents'),
  require('./015_access_overrides'),
  // Фаза 5 — Content + Notifications
  require('./016_notifications_outbox'),
  require('./017_notification_log_v2'),
  require('./018_documents_v2'),
  require('./019_packages_v2'),
  require('./020_announcements_v2'),
  require('./021_property_audit_log'),
  // Фаза 6 — Templates extraction
  require('./022_notification_templates_v2'),
  // Фаза 0 — legacy uid → v1 actor id bridge
  require('./023_actor_external_uid'),
  // Access list planner support
  require('./024_access_request_list_indexes'),
  // Access request lifecycle production-slice status
  require('./025_access_request_escalated_status'),
  // DH-03 role/scope membership foundation
  require('./026_role_scope_memberships'),
  // DH-06 durable access zones / access points topology
  require('./027_access_topology'),
  // DH-13/DH-14 access policy CRUD and deterministic evaluation
  require('./028_access_policies'),
  // DH-22 service/territory/emergency request baseline
  require('./029_service_request_core'),
  // DH-23 request attachments and resident-visible updates
  require('./030_request_attachments_updates'),
  // DH-24 request assignment, SLA state and escalation events
  require('./031_request_assignment_sla'),
  // DH-27 technician execution workflow fields and KPI event stream
  require('./032_technician_workflow'),
  // DH-29 contractor assignment binding and KPI event stream
  require('./033_contractor_workflow'),
  // DH-41 SKUD provider config, hardware mapping and integration event logs
  require('./034_skud_adapter_framework'),
  // DH-43 video evidence references linked to access events/incidents
  require('./035_video_evidence_baseline'),
  // DH-43 VMS/NVR provider configs and camera mappings
  require('./036_video_provider_configs'),
  // DH-42 common Russia SKUD provider adapter expansion
  require('./037_skud_russia_provider_wave'),
  // DH-44 ERP/1C/ZhKH operational exchange baseline
  require('./038_erp_exchange_baseline'),
  // DH-45 materialized KPI snapshots for analytics/reporting
  require('./039_analytics_aggregation_snapshots'),
  // DH-03/DH-08/DH-17..21 persisted memberships, reviews and lifecycle ledger
  require('./040_membership_review_lifecycle'),
  // DH-60 sensitive-action assignment, SLA and review queue operations
  require('./041_sensitive_review_ops'),
  // DH-55 resident offboarding cascade and household/unit links
  require('./042_resident_offboarding_cascade'),
  // DH-57 emergency dispatch runtime profiles
  require('./043_emergency_dispatch_mode'),
];

const LATEST_V1_PROPERTY_MIGRATION_ID =
  V1_PROPERTY_MIGRATIONS[V1_PROPERTY_MIGRATIONS.length - 1].id;

module.exports = {
  V1_PROPERTY_MIGRATIONS,
  LATEST_V1_PROPERTY_MIGRATION_ID,
};
