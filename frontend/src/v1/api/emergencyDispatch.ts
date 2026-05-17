/**
 * platform-v1 emergency dispatch readiness client.
 * Backend: backend/src/routes/requests.js mounted at /api/v1/requests.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  EmergencyDispatchDrillResponse,
  EmergencyDispatchReadinessResponse,
  EmergencyEscalationTarget,
  EmergencySeverity,
  EmergencyType,
  EmergencyDrillStatus,
  UUID,
} from './types';

export interface GetEmergencyDispatchReadinessParams {
  property_id?: UUID;
  propertyId?: UUID;
  window_hours?: number;
  windowHours?: number;
  limit?: number;
}

export interface CreateEmergencyDrillBody {
  property_id?: UUID;
  propertyId?: UUID;
  scenarioType: EmergencyType;
  severity?: EmergencySeverity;
  escalationTarget?: EmergencyEscalationTarget;
  status?: EmergencyDrillStatus;
  requestId?: string;
  summary?: string;
  findings?: Record<string, unknown>;
  notificationEvidence?: Record<string, unknown>;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, value]) => value !== undefined && value !== null && value !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of entries) qs.set(key, String(value));
  return `?${qs.toString()}`;
}

export const emergencyDispatchApi = {
  readiness(params?: GetEmergencyDispatchReadinessParams, opts?: RequestOpts) {
    return v1Client.get<EmergencyDispatchReadinessResponse>(
      `/requests/emergency/readiness${toQuery(params)}`,
      opts,
    );
  },

  createDrill(body: CreateEmergencyDrillBody, opts?: RequestOpts) {
    return v1Client.post<EmergencyDispatchDrillResponse>(
      '/requests/emergency/drills',
      body,
      opts,
    );
  },
};
