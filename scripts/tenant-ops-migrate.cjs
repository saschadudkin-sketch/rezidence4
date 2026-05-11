#!/usr/bin/env node
'use strict';

const {
  formatBatchReport,
  parseBatchArgs,
  runTenantMigrationBatch,
} = require('./tenant-ops-core.cjs');

async function main() {
  const options = parseBatchArgs(process.argv.slice(2));
  const result = await runTenantMigrationBatch({ options });
  // eslint-disable-next-line no-console
  console.log(formatBatchReport(result));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[tenant-ops-migrate] ${err.stack || err.message}`);
    process.exit(1);
  });
}
