import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE_URL } from '../../config/apiBaseUrl';
import {
  invalidateAccessRequest,
  invalidatePass,
  invalidateVehicle,
  qk,
  useV1SessionState,
} from '../store';
import type { UUID } from '../api/types';

interface AccessEventPayload {
  event_type?: string;
  access_request_id?: UUID;
  pass_id?: UUID;
  vehicle_id?: UUID;
  plate_number?: string;
  incident_id?: UUID;
}

function parsePayload(raw: string): AccessEventPayload | null {
  try {
    const parsed = JSON.parse(raw) as AccessEventPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function useAccessEvents() {
  const queryClient = useQueryClient();
  const { status } = useV1SessionState();

  useEffect(() => {
    if (status !== 'ready') return undefined;
    const EventSourceCtor = globalThis.EventSource;
    if (!EventSourceCtor) return undefined;

    const source = new EventSourceCtor(`${API_BASE_URL}/api/v1/events`, { withCredentials: true });
    const onAccessEvent = (event: MessageEvent<string>) => {
      const payload = parsePayload(event.data);
      if (!payload?.event_type) return;

      if (payload.access_request_id) {
        void invalidateAccessRequest(queryClient, payload.access_request_id);
      }
      if (payload.pass_id) {
        void invalidatePass(queryClient, payload.pass_id);
      }
      if (payload.vehicle_id) {
        void invalidateVehicle(queryClient, payload.vehicle_id, payload.plate_number);
      }
      if (payload.incident_id) {
        void Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.incidents.byId(payload.incident_id) }),
          queryClient.invalidateQueries({ queryKey: qk.incidents.all }),
        ]);
      }
    };

    source.addEventListener('access_event', onAccessEvent as EventListener);
    return () => {
      source.removeEventListener('access_event', onAccessEvent as EventListener);
      source.close();
    };
  }, [queryClient, status]);
}
