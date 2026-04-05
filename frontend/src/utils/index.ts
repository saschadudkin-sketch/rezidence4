/**
 * utils/index.ts — ЖЕЛАТ-CQ1: barrel export for utility modules.
 *
 * Enables clean imports throughout the codebase:
 *   import { formatPhone, genId, fmtDate } from '../utils'
 * Instead of per-module imports:
 *   import { formatPhone } from '../utils/phoneUtils'
 *   import { genId } from '../utils/idUtils'
 *
 * NOTE: Existing imports using direct module paths still work — this barrel
 * is additive. Migrate gradually; don't do a mass find-replace in one PR.
 */

// ── Phone utilities
export { formatPhone, normalizePhone, findByPhone } from './phoneUtils';

// ── ID generation
export { genId } from './idUtils';

// ── Date / time formatting
export { fmtDate, fmtTime, filterByPeriod, groupReqs, sortReqs } from './dateUtils';

// ── Browser notifications
export { requestNotifPerm, sendNotif, playAlert } from './notifUtils';

// ── Service worker
export { registerSW } from './swUtils';

// ── Image compression
export { compressImage } from './compressImage';

// ── Analytics / metrics
export { emitLoginMetric } from './loginMetrics';
