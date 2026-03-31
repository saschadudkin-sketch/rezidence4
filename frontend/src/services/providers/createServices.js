import * as runtimeMode from '../../config/runtimeMode.js';
import { createDemoProvider } from './demoProvider.js';
import { createBackendProvider } from './backendProvider.js';

const LIVE_MODE = runtimeMode.LIVE_MODE || 'live';
const DEMO_MODE = runtimeMode.DEMO_MODE || 'demo';

function normalizeServiceMode(mode) {
  const normalized = typeof mode === 'string' ? mode.trim().toLowerCase() : '';
  return normalized === LIVE_MODE ? LIVE_MODE : DEMO_MODE;
}

/**
 * Фабрика сервисов.
 * live  → backendProvider (Node.js + PostgreSQL на VPS)
 * demo  → demoProvider (localStorage, без сервера)
 */
export function createServices(mode = runtimeMode.MODE) {
  const resolvedMode = normalizeServiceMode(mode);
  const provider = resolvedMode === LIVE_MODE
    ? createBackendProvider()
    : createDemoProvider();
  return { mode: resolvedMode, ...provider };
}
