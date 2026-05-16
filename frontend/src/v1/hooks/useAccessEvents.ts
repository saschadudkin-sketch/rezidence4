import { useEffect, useRef, useState } from 'react';
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

export type AccessEventsState = 'idle' | 'connecting' | 'open' | 'degraded' | 'unsupported';

function parsePayload(raw: string): AccessEventPayload | null {
  try {
    const parsed = JSON.parse(raw) as AccessEventPayload;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function useAccessEvents(): AccessEventsState {
  const queryClient = useQueryClient();
  const { status: sessionStatus } = useV1SessionState();
  const [eventsState, setEventsState] = useState<AccessEventsState>('idle');
  const pendingRef = useRef<AccessEventPayload[]>([]);
  const flushTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (sessionStatus !== 'ready') {
      setEventsState('idle');
      return undefined;
    }
    const EventSourceCtor = globalThis.EventSource;
    if (!EventSourceCtor) {
      setEventsState('unsupported');
      return undefined;
    }

    setEventsState('connecting');
    const source = new EventSourceCtor(`${API_BASE_URL}/api/v1/events`, { withCredentials: true });
    const flush = () => {
      flushTimerRef.current = null;
      const batch = pendingRef.current;
      pendingRef.current = [];
      if (batch.length === 0) return;

      const accessRequestIds = new Set<UUID>();
      const passIds = new Set<UUID>();
      const vehicles = new Map<UUID, string | undefined>();
      const incidentIds = new Set<UUID>();

      for (const payload of batch) {
        if (payload.access_request_id) accessRequestIds.add(payload.access_request_id);
        if (payload.pass_id) passIds.add(payload.pass_id);
        if (payload.vehicle_id) vehicles.set(payload.vehicle_id, payload.plate_number);
        if (payload.incident_id) incidentIds.add(payload.incident_id);
      }

      void Promise.all([
        ...Array.from(accessRequestIds, (id) => invalidateAccessRequest(queryClient, id)),
        ...Array.from(passIds, (id) => invalidatePass(queryClient, id)),
        ...Array.from(vehicles, ([id, plateNumber]) => invalidateVehicle(queryClient, id, plateNumber)),
        ...Array.from(incidentIds, (id) => Promise.all([
          queryClient.invalidateQueries({ queryKey: qk.incidents.byId(id) }),
          queryClient.invalidateQueries({ queryKey: qk.incidents.all }),
        ])),
      ]);
    };

    const scheduleFlush = () => {
      if (flushTimerRef.current !== null) return;
      flushTimerRef.current = window.setTimeout(flush, 100);
    };

    const onOpen = () => setEventsState('open');
    const onError = () => setEventsState('degraded');
    const onAccessEvent = (event: MessageEvent<string>) => {
      const payload = parsePayload(event.data);
      if (!payload?.event_type) return;
      pendingRef.current.push(payload);
      scheduleFlush();
    };

    source.addEventListener('open', onOpen as EventListener);
    source.addEventListener('error', onError as EventListener);
    source.addEventListener('access_event', onAccessEvent as EventListener);
    return () => {
      source.removeEventListener('open', onOpen as EventListener);
      source.removeEventListener('error', onError as EventListener);
      source.removeEventListener('access_event', onAccessEvent as EventListener);
      source.close();
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingRef.current = [];
    };
  }, [queryClient, sessionStatus]);

  return eventsState;
}
