import { createServices } from './createServices';
import type { ServiceContainer } from './ServiceContracts';

/**
 * A-03: services — module-level singleton for mode-aware service access.
 *
 * WHY SINGLETON: The runtime mode (live|demo) is determined once at startup from
 * VITE_RUNTIME_MODE and never changes during the session. A single `services`
 * object is therefore sufficient — no need to re-create the service graph per
 * component or per request. React components import `services` directly rather
 * than receiving it as a prop, which keeps prop-drilling out of the component tree.
 *
 * FACTORY PATTERN: `createServices(mode)` wires the correct concrete provider:
 *   live mode  → backendProvider  (HTTP ↔ Node.js/Express, JWT, SSE)
 *   demo mode  → demoProvider     (localStorage, in-memory, no server)
 *
 * The returned `services` object exposes a stable interface regardless of mode:
 *   services.auth       — sendOtp, verifyOtp, getMe, logout, refresh
 *   services.requests   — submit, updateEverywhere, deleteEverywhere, resolvePhotos
 *   services.chat       — sendMessage
 *   services.admin      — savePermsEverywhere, saveUserEverywhere, removeUserEverywhere
 *   services.liveData   — startSync (SSE in live, demo fixture loader in demo)
 *
 * TESTING: Tests that need to control service behaviour should mock this module:
 *   vi.mock('../services/providers/serviceContainer', () => ({
 *     services: { requests: { submit: vi.fn() }, ... }
 *   }));
 *
 * Do NOT call createServices() a second time elsewhere — import from this file.
 */
export const services: ServiceContainer = createServices();
