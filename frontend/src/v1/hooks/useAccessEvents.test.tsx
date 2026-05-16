import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useAccessEvents } from './useAccessEvents';

const {
  invalidateAccessRequestMock,
  invalidatePassMock,
  invalidateVehicleMock,
  useV1SessionStateMock,
} = vi.hoisted(() => ({
  invalidateAccessRequestMock: vi.fn(),
  invalidatePassMock: vi.fn(),
  invalidateVehicleMock: vi.fn(),
  useV1SessionStateMock: vi.fn(),
}));

vi.mock('../store', async () => {
  const actual = await vi.importActual<typeof import('../store')>('../store');
  return {
    ...actual,
    invalidateAccessRequest: invalidateAccessRequestMock,
    invalidatePass: invalidatePassMock,
    invalidateVehicle: invalidateVehicleMock,
    useV1SessionState: useV1SessionStateMock,
    qk: {
      incidents: {
        byId: (id: string) => ['incident', id],
        all: ['incidents'],
      },
    },
  };
});

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Set<EventListener>>();
  readonly url: string;
  readonly withCredentials: boolean | undefined;
  close = vi.fn();

  constructor(url: string, init?: EventSourceInit) {
    this.url = url;
    this.withCredentials = init?.withCredentials;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<string>);
    }
  }
}

function Harness() {
  const state = useAccessEvents();
  return <div>{state}</div>;
}

function renderHookHarness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('useAccessEvents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    useV1SessionStateMock.mockReturnValue({ status: 'ready' });
    vi.stubGlobal('EventSource', FakeEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('reports EventSource degraded state', () => {
    renderHookHarness();

    expect(FakeEventSource.instances).toHaveLength(1);
    act(() => {
      FakeEventSource.instances[0].emit('error');
    });

    expect(screen.getByText('degraded')).toBeInTheDocument();
  });

  test('batches duplicate access event invalidations', () => {
    renderHookHarness();

    const source = FakeEventSource.instances[0];
    source.emit('access_event', JSON.stringify({
      event_type: 'access_request_updated',
      access_request_id: '11111111-1111-4111-8111-111111111111',
      pass_id: '22222222-2222-4222-8222-222222222222',
      vehicle_id: '33333333-3333-4333-8333-333333333333',
      plate_number: 'A001AA77',
    }));
    source.emit('access_event', JSON.stringify({
      event_type: 'access_request_updated',
      access_request_id: '11111111-1111-4111-8111-111111111111',
    }));

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(invalidateAccessRequestMock).toHaveBeenCalledTimes(1);
    expect(invalidatePassMock).toHaveBeenCalledTimes(1);
    expect(invalidateVehicleMock).toHaveBeenCalledTimes(1);
  });
});
