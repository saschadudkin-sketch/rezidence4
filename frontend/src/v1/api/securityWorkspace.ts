/**
 * platform-v1 security workspace client.
 * Backend: backend/src/v1/routes/securityWorkspace.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  ManualSecurityDecisionRequest,
  ManualSecurityDecisionResponse,
  SecurityOfflineReplayEvent,
  SecurityOfflineReplayResponse,
  UUID,
} from './types';

export const securityWorkspaceApi = {
  manualDecision(body: ManualSecurityDecisionRequest, opts?: RequestOpts) {
    return v1Client.post<ManualSecurityDecisionResponse>(
      '/security-workspace/manual-decision',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
  offlineReplay(body: { property_id: UUID; events: SecurityOfflineReplayEvent[] }, opts?: RequestOpts) {
    return v1Client.post<SecurityOfflineReplayResponse>(
      '/security-workspace/offline-replay',
      body,
      {
        ...opts,
        skipRetry: true,
      },
    );
  },
};
