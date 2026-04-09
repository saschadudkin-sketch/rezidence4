import * as runtimeMode from '../../config/runtimeMode';
import { createDemoProvider } from './demoProvider';
import { createBackendProvider } from './backendProvider';
import { assertServiceContracts, type ServiceContainer, type ServiceMode } from './ServiceContracts';

const LIVE_MODE = runtimeMode.LIVE_MODE || 'live';
const DEMO_MODE = runtimeMode.DEMO_MODE || 'demo';
const DEMO_ENABLED = runtimeMode.DEMO_ENABLED ?? false;

function normalizeServiceMode(mode) {
  const normalized = runtimeMode.normalizeMode
    ? runtimeMode.normalizeMode(mode)
    : (typeof mode === 'string' ? mode.trim().toLowerCase() : '');
  if (normalized === LIVE_MODE) return LIVE_MODE;
  if (normalized === DEMO_MODE && DEMO_ENABLED) return DEMO_MODE;
  return DEMO_ENABLED ? DEMO_MODE : LIVE_MODE;
}

/**
 * Фабрика сервисов.
 * live  → backendProvider (Node.js + PostgreSQL на VPS)
 * demo  → demoProvider (localStorage, без сервера, только internal sandbox)
 */
export function createServices(mode = runtimeMode.MODE) {
  const resolvedMode = normalizeServiceMode(mode) as ServiceMode;
  const provider = resolvedMode === LIVE_MODE
    ? createBackendProvider()
    : createDemoProvider();
  return { mode: resolvedMode, ...assertServiceContracts(provider) } satisfies ServiceContainer;
}
