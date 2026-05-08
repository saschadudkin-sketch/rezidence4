/**
 * platform-v1 security workspace client.
 * Backend: backend/src/v1/routes/securityWorkspace.js
 */

import { v1Client, type RequestOpts } from './client';
import type {
  ManualSecurityDecisionRequest,
  ManualSecurityDecisionResponse,
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
};
