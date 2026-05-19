#!/usr/bin/env node
'use strict';

const {
  formatProvisionReport,
  parseProvisionArgs,
  provisionTenant,
} = require('./tenant-ops-core.cjs');
const { loadEnvFilesDefault } = require('./e2e-env.cjs');

async function main() {
  loadEnvFilesDefault();
  const input = parseProvisionArgs(process.argv.slice(2));
  const result = await provisionTenant({ input });
  // eslint-disable-next-line no-console
  console.log(formatProvisionReport(result));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[tenant-ops-provision] ${err.stack || err.message}`);
    process.exit(1);
  });
}
