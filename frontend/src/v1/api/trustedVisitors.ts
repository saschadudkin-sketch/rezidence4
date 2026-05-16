/**
 * platform-v1 trusted visitors client.
 * Backend: backend/src/v1/routes/trustedVisitors.js
 * Spec: docs/product/specs/domhub-access-competitive-improvement-plan.md Phase 4.
 */

import { v1Client, type RequestOpts } from './client';
import type {
  AccessRequest,
  IsoDateTime,
  PassSummary,
  RequestType,
  TrustedVisitor,
  TrustedVisitorType,
  UUID,
} from './types';

export type TrustedVisitorPassRequestType = Exclude<RequestType, 'vehicle_access'>;

export interface ListTrustedVisitorsParams {
  property_id: UUID;
  include_inactive?: boolean;
}

export interface CreateTrustedVisitorBody {
  property_id: UUID;
  name: string;
  phone?: string | null;
  visitor_type?: TrustedVisitorType;
  default_vehicle_plate?: string | null;
  default_instructions?: string | null;
  allowed_zone_id?: UUID | null;
  allowed_point_id?: UUID | null;
}

export type UpdateTrustedVisitorBody = Partial<Omit<CreateTrustedVisitorBody, 'property_id'>>;

export interface CreatePassFromTrustedVisitorBody {
  property_id: UUID;
  target_unit_id: UUID;
  target_zone_id?: UUID | null;
  target_point_id?: UUID | null;
  request_type?: TrustedVisitorPassRequestType;
  request_id?: string | null;
  reason?: string | null;
  guest_instructions?: string | null;
  guard_notes?: string | null;
  share_delivery_channels?: string[];
  starts_at: IsoDateTime;
  ends_at: IsoDateTime;
}

function toQuery(params: object | undefined): string {
  if (!params) return '';
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (!entries.length) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of entries) qs.set(k, String(v));
  return `?${qs.toString()}`;
}

export const trustedVisitorsApi = {
  list(params: ListTrustedVisitorsParams, opts?: RequestOpts) {
    return v1Client.get<{ trusted_visitors: TrustedVisitor[] }>(
      `/trusted-visitors${toQuery(params)}`,
      opts,
    );
  },
  create(body: CreateTrustedVisitorBody, opts?: RequestOpts) {
    return v1Client.post<{ trusted_visitor: TrustedVisitor }>(
      '/trusted-visitors',
      body,
      opts,
    );
  },
  update(id: UUID, body: UpdateTrustedVisitorBody, opts?: RequestOpts) {
    return v1Client.patch<{ trusted_visitor: TrustedVisitor }>(
      `/trusted-visitors/${id}`,
      body,
      opts,
    );
  },
  deactivate(id: UUID, body: { property_id: UUID }, opts?: RequestOpts) {
    return v1Client.post<{ trusted_visitor: TrustedVisitor }>(
      `/trusted-visitors/${id}/deactivate`,
      body,
      opts,
    );
  },
  createPass(id: UUID, body: CreatePassFromTrustedVisitorBody, opts?: RequestOpts) {
    return v1Client.post<{
      trusted_visitor: TrustedVisitor;
      access_request: AccessRequest;
      pass?: PassSummary | null;
    }>(
      `/trusted-visitors/${id}/create-pass`,
      body,
      opts,
    );
  },
};
