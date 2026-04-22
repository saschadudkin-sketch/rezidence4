'use strict';

const { HikvisionAdapter } = require('./HikvisionAdapter');
const { BolidAdapter }     = require('./BolidAdapter');

/**
 * createSkudAdapter — factory that returns the correct adapter instance for
 * a given property, or null if SKUD integration is not configured.
 *
 * Resolution order:
 *   1. property.feature_flags.skud_adapter  (per-property override)
 *   2. SKUD_ADAPTER env var                 (global default)
 *   3. null                                  (SKUD disabled)
 *
 * Required env vars when adapter is active:
 *   SKUD_API_URL, SKUD_API_USER, SKUD_API_PASSWORD
 *
 * @param {object|null} property — property row, may include feature_flags JSONB
 * @returns {SkudAdapter|null}
 */
function createSkudAdapter(property) {
  const adapterType =
    property?.feature_flags?.skud_adapter ||
    process.env.SKUD_ADAPTER ||
    null;

  if (!adapterType) return null;

  const cfg = {
    apiUrl:   process.env.SKUD_API_URL      || '',
    username: process.env.SKUD_API_USER     || '',
    password: process.env.SKUD_API_PASSWORD || '',
  };

  if (adapterType === 'hikvision') return new HikvisionAdapter(cfg);
  if (adapterType === 'bolid')     return new BolidAdapter(cfg);

  return null;
}

module.exports = { createSkudAdapter };
