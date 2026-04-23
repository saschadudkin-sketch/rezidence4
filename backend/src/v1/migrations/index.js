'use strict';

// platform-v1 property-DB migrations index.
// Each migration is a `{ id, up(client) }` module, run in array order by
// db.migrate() after the legacy MIGRATIONS array.  IDs are prefixed `v1_` so
// they never collide with legacy IDs in schema_migrations.
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
];

const LATEST_V1_PROPERTY_MIGRATION_ID =
  V1_PROPERTY_MIGRATIONS[V1_PROPERTY_MIGRATIONS.length - 1].id;

module.exports = {
  V1_PROPERTY_MIGRATIONS,
  LATEST_V1_PROPERTY_MIGRATION_ID,
};
